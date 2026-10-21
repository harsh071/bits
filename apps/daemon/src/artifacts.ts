import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLibrary } from "@agentable-ui/lang";
import { uiCatalog } from "@agentable-ui/ui";
import { validateInput } from "@agentable-ui/core";
import type { Artifact, ArtifactAction, ArtifactActivity, ArtifactMeta, DataOp } from "@bits/protocol";
import { bus } from "./bus.ts";
import { config } from "./config.ts";

// Artifacts are small persistent apps, stored as plain files so you (and Bits) can read and edit them:
//
//   ~/.bits/artifacts/<id>/artifact.json   meta + declared actions
//   ~/.bits/artifacts/<id>/view.agl        the view, in Agentable Lang
//   ~/.bits/artifacts/<id>/data.json       the data the view binds as $data.*
//   ~/.bits/artifacts/<id>/activity.jsonl  who ran which action, when
//   ~/.bits/artifacts/<id>/history/v<N>.agl previous views
//
// Data changes only through declared actions (people, Bits, and WebMCP agents all use the same ones)
// or through Bits' own artifact_data tool. Actions are data-only operations, never code.

const ROOT = path.join(config.home, "artifacts");
export const library = createLibrary(uiCatalog as any);

type Stored = ArtifactMeta & { dataVersion: number };

const dir = (id: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new Error(`Bad artifact id "${id}"`);
  return path.join(ROOT, id);
};

function writeJson(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file); // atomic replace
}

function slug(title: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "artifact";
  return `${base}-${randomUUID().slice(0, 6)}`;
}

// ---------- program validation ----------

export interface ProgramIssue {
  code: string;
  message: string;
  line?: number;
}

/** Parse an Agentable Lang program against the catalog. Returns blocking errors for the model to fix. */
export function checkProgram(program: string, actionNames: string[] = []): ProgramIssue[] {
  const result: any = library.parse(program);
  const issues: ProgramIssue[] = (result.errors ?? [])
    .filter((e: any) => e.severity !== "warning")
    .map((e: any) => ({ code: e.code, message: e.message, line: e.line }));
  if (!result.root) issues.push({ code: "no-root", message: 'The program needs a statement named "root".' });
  if (result.unresolved?.length) issues.push({ code: "unresolved", message: `Undefined names: ${result.unresolved.join(", ")}` });
  // @Tool calls in an artifact must name one of its actions.
  for (const m of program.matchAll(/@Tool\(\s*"([^"]+)"/g)) {
    if (actionNames.length && !actionNames.includes(m[1])) {
      issues.push({ code: "unknown-action", message: `@Tool("${m[1]}") isn't a declared action. Actions: ${actionNames.join(", ")}` });
    }
  }
  return issues;
}

export const formatIssues = (issues: ProgramIssue[]) =>
  issues
    .slice(0, 10)
    .map((i) => `- ${i.line ? `line ${i.line}: ` : ""}[${i.code}] ${i.message}`)
    .join("\n");

/** The Agentable Lang guide for the system prompt (stable → cache-friendly). */
export function langGuide() {
  return library.prompt({
    preamble:
      "Bits shows interfaces by writing Agentable Lang, a small line-based UI language (used by the `present` tool and by artifact views). Each line defines one node: `name = Component(args)`.",
    rules: [
      "Write programs as the tool's `program` argument — never in your text reply.",
      "In artifacts, read saved data with $data.* and change it ONLY with @Tool(\"<action name>\", {…}) calling one of the artifact's declared actions. $ui.* is for local view state (drafts, selection, tabs).",
      "In inline `present` views, buttons that should talk back to you use @Say(\"…\"), which sends that text as the user's next message.",
      "Events and props are always arguments of the component call, e.g. `name = TextInput(\"Name\", value: $ui.name, change: @Set($ui.name, $event))`. Never write separate `node.prop = …` lines; they don't parse.",
    ],
  });
}

// ---------- data ops ----------

type Seg = { key: string } | { index: number } | { match: { field: string; value: string } };

function parsePath(p: string): Seg[] {
  const segs: Seg[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]|\[([a-zA-Z0-9_]+)=([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) {
    if (m[1] !== undefined) segs.push({ key: m[1] });
    else if (m[2] !== undefined) segs.push({ index: Number(m[2]) });
    else segs.push({ match: { field: m[3], value: m[4] } });
  }
  if (!segs.length) throw new Error(`Empty path "${p}"`);
  return segs;
}

function resolveRef(v: unknown, input: unknown): unknown {
  if (typeof v === "string") {
    if (v === "$id") return randomUUID().slice(0, 8);
    if (v === "$now") return new Date().toISOString();
    if (v === "$input") return input;
    if (v.startsWith("$input.")) {
      return v
        .slice(7)
        .split(".")
        .reduce<any>((o, k) => (o == null ? undefined : o[k]), input);
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => resolveRef(x, input));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRef(x, input)]));
  return v;
}

function step(container: any, seg: Seg, input: unknown, create: boolean): { parent: any; key: string | number } | null {
  if ("key" in seg) {
    if (create && (container[seg.key] === undefined || container[seg.key] === null)) container[seg.key] = {};
    return { parent: container, key: seg.key };
  }
  if (!Array.isArray(container)) return null;
  if ("index" in seg) return { parent: container, key: seg.index };
  const want = resolveRef(seg.match.value, input);
  const idx = container.findIndex((x: any) => x && String(x[seg.match.field]) === String(want));
  return idx === -1 ? null : { parent: container, key: idx };
}

/** Walk to the parent of the final segment; returns null when a selector matches nothing. */
function locate(root: any, p: string, input: unknown) {
  const segs = parsePath(p);
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = step(cur, segs[i], input, true);
    if (!s) return null;
    cur = s.parent[s.key];
  }
  return step(cur, segs[segs.length - 1], input, false);
}

export function applyOps(data: Record<string, unknown>, ops: DataOp[], input: unknown = {}) {
  const next = structuredClone(data);
  for (const op of ops) {
    const at = locate(next, op.path, input);
    if (!at) throw new Error(`Nothing matches "${op.path}"`);
    const { parent, key } = at;
    switch (op.op) {
      case "set":
        parent[key] = resolveRef(op.value, input);
        break;
      case "merge":
        parent[key] = { ...(parent[key] ?? {}), ...(resolveRef(op.value, input) as object) };
        break;
      case "push": {
        if (parent[key] === undefined) parent[key] = [];
        if (!Array.isArray(parent[key])) throw new Error(`"${op.path}" is not a list`);
        const value = resolveRef(op.value, input);
        // Give pushed objects an id so later actions can target them.
        parent[key].push(value && typeof value === "object" && !Array.isArray(value) && !("id" in value) ? { id: randomUUID().slice(0, 8), ...value } : value);
        break;
      }
      case "remove":
        if (Array.isArray(parent)) parent.splice(key as number, 1);
        else delete parent[key];
        break;
      case "increment":
        parent[key] = Number(parent[key] ?? 0) + Number(op.by ?? 1);
        break;
      case "toggle":
        parent[key] = !parent[key];
        break;
      default:
        throw new Error(`Unknown op ${(op as any).op}`);
    }
  }
  return next;
}

function checkActions(actions: Record<string, ArtifactAction>) {
  for (const [name, a] of Object.entries(actions)) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(name)) throw new Error(`Action names are snake_case: "${name}"`);
    if (!Array.isArray(a.ops) || !a.ops.length) throw new Error(`Action "${name}" needs at least one op`);
    for (const op of a.ops) parsePath(op.path);
  }
}

// ---------- store ----------

export class Artifacts {
  /** Called when an action marked notify:true runs, so Bits can react. */
  onNotify: (artifact: ArtifactMeta, action: string, input: unknown, by: ArtifactActivity["by"]) => void = () => {};

  constructor() {
    fs.mkdirSync(ROOT, { recursive: true });
  }

  list(): ArtifactMeta[] {
    return fs
      .readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, "artifact.json")))
      .map((d) => this.meta(d.name))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private meta(id: string): Stored {
    return JSON.parse(fs.readFileSync(path.join(dir(id), "artifact.json"), "utf8"));
  }

  exists(id: string) {
    try {
      return fs.existsSync(path.join(dir(id), "artifact.json"));
    } catch {
      return false;
    }
  }

  get(id: string): Artifact & { dataVersion: number } {
    if (!this.exists(id)) throw new Error(`No artifact "${id}"`);
    const meta = this.meta(id);
    return {
      ...meta,
      program: fs.readFileSync(path.join(dir(id), "view.agl"), "utf8"),
      data: JSON.parse(fs.readFileSync(path.join(dir(id), "data.json"), "utf8")),
    };
  }

  activity(id: string, limit = 20): ArtifactActivity[] {
    const file = path.join(dir(id), "activity.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((l) => JSON.parse(l));
  }

  create(input: {
    title: string;
    kind: string;
    description: string;
    icon?: string;
    program: string;
    data: Record<string, unknown>;
    actions: Record<string, ArtifactAction>;
    conversationId: string;
  }): Artifact {
    checkActions(input.actions);
    const issues = checkProgram(input.program, Object.keys(input.actions));
    if (issues.length) throw new Error(`The view has problems — fix and call again:\n${formatIssues(issues)}`);
    const id = slug(input.title);
    const now = Date.now();
    const meta: Stored = {
      id,
      title: input.title,
      kind: input.kind,
      description: input.description,
      icon: input.icon,
      conversationId: input.conversationId,
      version: 1,
      dataVersion: 1,
      createdAt: now,
      updatedAt: now,
      actions: input.actions,
    };
    fs.mkdirSync(path.join(dir(id), "history"), { recursive: true });
    fs.writeFileSync(path.join(dir(id), "view.agl"), input.program.trim() + "\n");
    fs.writeFileSync(path.join(dir(id), "history", "v1.agl"), input.program.trim() + "\n");
    writeJson(path.join(dir(id), "data.json"), input.data ?? {});
    writeJson(path.join(dir(id), "artifact.json"), meta);
    this.emit(meta, true);
    return this.get(id);
  }

  update(id: string, patch: Partial<Pick<Artifact, "title" | "description" | "kind" | "icon" | "program" | "actions">>): Artifact {
    const cur = this.get(id);
    const actions = patch.actions ?? cur.actions;
    checkActions(actions);
    const program = patch.program ?? cur.program;
    const issues = checkProgram(program, Object.keys(actions));
    if (issues.length) throw new Error(`The view has problems — fix and call again:\n${formatIssues(issues)}`);
    const meta: Stored = {
      ...this.meta(id),
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.description ? { description: patch.description } : {}),
      ...(patch.kind ? { kind: patch.kind } : {}),
      ...(patch.icon ? { icon: patch.icon } : {}),
      actions,
      version: cur.version + (patch.program ? 1 : 0),
      updatedAt: Date.now(),
    };
    if (patch.program) {
      fs.writeFileSync(path.join(dir(id), "view.agl"), program.trim() + "\n");
      fs.writeFileSync(path.join(dir(id), "history", `v${meta.version}.agl`), program.trim() + "\n");
    }
    writeJson(path.join(dir(id), "artifact.json"), meta);
    this.emit(meta, true);
    return this.get(id);
  }

  /** Bits edits data directly (no declared action needed). */
  patchData(id: string, ops: DataOp[]) {
    const cur = this.get(id);
    const data = applyOps(cur.data, ops);
    return this.saveData(id, data, { at: Date.now(), action: "(direct edit)", input: ops, by: "bits" });
  }

  async runAction(id: string, name: string, input: unknown, by: ArtifactActivity["by"]) {
    const cur = this.get(id);
    const action = cur.actions[name];
    if (!action) throw new Error(`"${cur.title}" has no action "${name}". Actions: ${Object.keys(cur.actions).join(", ")}`);
    let value: any = input ?? {};
    if (action.input) {
      const v = await validateInput(action.input as any, value);
      if (!v.ok) throw new Error(`Invalid input: ${v.issues.map((i) => `${i.path || "input"} ${i.message}`).join("; ")}`);
      value = v.value;
    }
    const data = applyOps(cur.data, action.ops, value);
    const saved = this.saveData(id, data, { at: Date.now(), action: name, input: value, by });
    if (action.notify) this.onNotify(cur, name, value, by);
    return saved;
  }

  private saveData(id: string, data: Record<string, unknown>, activity: ArtifactActivity) {
    writeJson(path.join(dir(id), "data.json"), data);
    fs.appendFileSync(path.join(dir(id), "activity.jsonl"), JSON.stringify(activity) + "\n");
    const meta = this.meta(id);
    meta.dataVersion += 1;
    meta.updatedAt = Date.now();
    writeJson(path.join(dir(id), "artifact.json"), meta);
    this.emit(meta, false);
    return { data, dataVersion: meta.dataVersion };
  }

  delete(id: string) {
    const trash = path.join(config.home, "trash");
    fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(dir(id), path.join(trash, `${id}-${Date.now()}`));
    bus.emit({ type: "artifacts" });
  }

  private emit(meta: Stored, listChanged: boolean) {
    bus.emit({ type: "artifact", id: meta.id, version: meta.version, dataVersion: meta.dataVersion });
    if (listChanged) bus.emit({ type: "artifacts" });
  }
}
