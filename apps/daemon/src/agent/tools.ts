import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Cron } from "croner";
import { config } from "../config.ts";
import * as memory from "../memory.ts";
import type { Store } from "../store.ts";
import { checkProgram, formatIssues, type Artifacts } from "../artifacts.ts";

// Every capability Bits has is a tool with a risk level. The Sentinel (sentinel.ts) decides,
// per call, whether a risk level can run on its own, needs a quick auto-review, or needs you.
//
//   read        — looks at things (memory, web). Always allowed.
//   write       — changes Bits' own files (memory, skills, workspace). Allowed.
//   external    — reaches outside Bits (shell, connectors that write). Auto-reviewed.
//   destructive — hard to undo (delete, send, pay). Always asks you unless you allowed it.
export type Risk = "read" | "write" | "external" | "destructive";

export interface ToolContext {
  store: Store;
  artifacts: Artifacts;
  conversationId: string;
  turnId: string;
  toolCallId: string;
  signal: AbortSignal;
  runHelper: (task: string, context: string | undefined, signal: AbortSignal) => Promise<string>;
}

export interface ToolDef<I = any> {
  name: string;
  description: string;
  /** zod schema, or a raw JSON schema for connector (MCP) tools */
  input: z.ZodType<I> | { jsonSchema: Record<string, unknown> };
  risk: Risk;
  /** Short present-tense label shown next to the mascot while it runs. */
  activity: (input: I) => string;
  /** When true, the turn ends after this tool (e.g. a question for the user). */
  endsTurn?: boolean;
  /** Excluded from helper subagents. */
  mainOnly?: boolean;
  execute: (input: I, ctx: ToolContext) => Promise<unknown>;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s);

function inWorkspace(p: string) {
  const abs = path.resolve(config.paths.workspace, p);
  const rel = path.relative(config.paths.workspace, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Path must stay inside the workspace");
  return abs;
}

function isPrivateHost(host: string) {
  return (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]"
  );
}

function htmlToText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { title, body };
}

async function webSearch(query: string, max = 6) {
  if (process.env.TAVILY_API_KEY) {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify({ query, max_results: max }),
    });
    const j: any = await r.json();
    return (j.results ?? []).map((x: any) => ({ title: x.title, url: x.url, snippet: x.content }));
  }
  if (process.env.BRAVE_API_KEY) {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?count=${max}&q=${encodeURIComponent(query)}`, {
      headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY, accept: "application/json" },
    });
    const j: any = await r.json();
    return (j.web?.results ?? []).map((x: any) => ({ title: x.title, url: x.url, snippet: x.description }));
  }
  // Zero-config fallback: DuckDuckGo's HTML endpoint.
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "Mozilla/5.0 (Bits personal agent)" },
  });
  const html = await r.text();
  const results: { title: string; url: string; snippet: string }[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    let url = m[1];
    const uddg = url.match(/uddg=([^&]+)/)?.[1];
    if (uddg) url = decodeURIComponent(uddg);
    if (url.startsWith("//")) url = "https:" + url;
    results.push({ title: htmlToText(m[2]).body, url, snippet: htmlToText(m[3]).body });
    if (results.length >= max) break;
  }
  return results;
}

function runShell(command: string, cwd: string, signal: AbortSignal, timeoutMs = 120_000) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.env.SHELL || "/bin/sh", ["-lc", command], { cwd, signal, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => (stderr += String(e)));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout: truncate(stdout, 20_000), stderr: truncate(stderr, 8_000) });
    });
  });
}

const tool = <I>(t: ToolDef<I>) => t;

export const builtinTools: ToolDef[] = [
  // ----- 1. what it already knows -----
  tool({
    name: "memory_search",
    description:
      "Search what you already know: the user's profile, the dated memory log, skills, and past conversations. Use this FIRST before asking the user or searching the web.",
    input: z.object({ query: z.string().describe("keywords") }),
    risk: "read",
    activity: () => "Checking memory",
    async execute({ query }, ctx) {
      const hits = memory.search(ctx.store.db, query);
      return hits.length ? hits : { hits: [], note: "Nothing found in memory." };
    },
  }),
  tool({
    name: "memory_remember",
    description:
      "Save one durable fact or preference about the user to the dated memory log (one short line, third person, e.g. 'Prefers aisle seats'). Use when the user tells you something worth knowing next time. Never store secrets or passwords.",
    input: z.object({ fact: z.string() }),
    risk: "write",
    activity: () => "Remembering",
    async execute({ fact }, ctx) {
      const line = memory.remember(fact);
      memory.reindex(ctx.store.db);
      return { saved: line };
    },
  }),
  tool({
    name: "memory_forget",
    description: "Remove memory log lines that contain the given text (when the user asks you to forget something).",
    input: z.object({ text: z.string() }),
    risk: "write",
    activity: () => "Forgetting",
    async execute({ text }, ctx) {
      const removed = memory.forget(text);
      memory.reindex(ctx.store.db);
      return { removed };
    },
  }),
  tool({
    name: "profile_write",
    description:
      "Rewrite the user's profile.md (always in your prompt). Use for core, stable facts: name, location, work, family, key preferences. Keep it short and organized; preserve existing content you aren't changing.",
    input: z.object({ content: z.string().describe("the full new markdown content") }),
    risk: "write",
    activity: () => "Updating profile",
    async execute({ content }, ctx) {
      memory.writeProfile(content);
      memory.reindex(ctx.store.db);
      return { ok: true };
    },
  }),
  tool({
    name: "skill_load",
    description: "Load the full instructions of a skill listed in your prompt. Do this before doing a task a skill covers.",
    input: z.object({ name: z.string() }),
    risk: "read",
    activity: (i) => `Reading skill ${i.name}`,
    async execute({ name }) {
      const s = memory.readSkill(name);
      if (!s) throw new Error(`No skill named ${name}`);
      return s;
    },
  }),
  tool({
    name: "skill_save",
    description:
      "Save (or update) a reusable skill: step-by-step instructions for a kind of task, so next time is faster. Use after finishing a multi-step task the user is likely to repeat, or when the user shows you how they like something done.",
    input: z.object({
      name: z.string().describe("lowercase-kebab-case"),
      description: z.string().describe('starts with "Use this when…"'),
      instructions: z.string().describe("markdown steps"),
    }),
    risk: "write",
    activity: (i) => `Learning skill ${i.name}`,
    async execute({ name, description, instructions }, ctx) {
      memory.saveSkill(name, description, instructions);
      memory.reindex(ctx.store.db);
      return { saved: name };
    },
  }),

  // ----- routines -----
  tool({
    name: "routine_save",
    description:
      "Create or update a routine: a prompt that runs on a schedule (cron, local time), e.g. '0 8 * * 1-5' for weekdays at 8:00. The prompt is written as an instruction to yourself.",
    input: z.object({
      name: z.string().describe("lowercase-kebab-case"),
      schedule: z.string().describe("5-field cron expression in local time"),
      prompt: z.string(),
      description: z.string().optional(),
      enabled: z.boolean().optional(),
    }),
    risk: "write",
    activity: (i) => `Scheduling ${i.name}`,
    async execute(i, ctx) {
      const next = new Cron(i.schedule).nextRun();
      memory.saveRoutine({
        name: i.name,
        schedule: i.schedule,
        prompt: i.prompt,
        description: i.description ?? "",
        enabled: i.enabled ?? true,
        conversation: ctx.conversationId,
      });
      return { saved: i.name, nextRun: next?.toString() ?? null };
    },
  }),
  tool({
    name: "routine_list",
    description: "List the user's routines.",
    input: z.object({}),
    risk: "read",
    activity: () => "Checking routines",
    async execute() {
      return memory.listRoutineFiles().map((r) => ({ ...r, nextRun: r.enabled ? new Cron(r.schedule).nextRun()?.toString() : null }));
    },
  }),
  tool({
    name: "routine_delete",
    description: "Delete a routine by name.",
    input: z.object({ name: z.string() }),
    risk: "write",
    activity: (i) => `Removing ${i.name}`,
    async execute({ name }) {
      memory.deleteRoutine(name);
      return { deleted: name };
    },
  }),

  // ----- 3. web -----
  tool({
    name: "web_search",
    description: "Search the web. Use after memory and connectors can't answer.",
    input: z.object({ query: z.string() }),
    risk: "read",
    activity: () => "Searching the web",
    async execute({ query }) {
      return webSearch(query);
    },
  }),
  tool({
    name: "web_fetch",
    description: "Fetch a public web page and return its readable text.",
    input: z.object({ url: z.string().url() }),
    risk: "read",
    activity: (i) => `Reading ${safeHost(i.url)}`,
    async execute({ url }, ctx) {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) throw new Error("Only public http(s) URLs");
      const r = await fetch(u, {
        headers: { "user-agent": "Mozilla/5.0 (Bits personal agent)" },
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]),
        redirect: "follow",
      });
      const type = r.headers.get("content-type") ?? "";
      const raw = await r.text();
      if (!type.includes("html")) return { status: r.status, contentType: type, text: truncate(raw, 15_000) };
      const { title, body } = htmlToText(raw);
      return { status: r.status, title, text: truncate(body, 15_000) };
    },
  }),

  // ----- 5. the agent's own computer (sandboxed workspace) -----
  tool({
    name: "run_command",
    description: `Run a shell command on your computer. Working directory defaults to your workspace (${config.paths.workspace}). Prefer connectors and web tools when they can do the job.`,
    input: z.object({ command: z.string(), cwd: z.string().optional().describe("relative to the workspace") }),
    risk: "external",
    activity: (i) => `Running ${i.command.split(/\s+/)[0]}`,
    async execute({ command, cwd }, ctx) {
      return runShell(command, cwd ? inWorkspace(cwd) : config.paths.workspace, ctx.signal);
    },
  }),
  tool({
    name: "read_file",
    description: "Read a text file from your workspace.",
    input: z.object({ path: z.string() }),
    risk: "read",
    activity: (i) => `Reading ${path.basename(i.path)}`,
    async execute({ path: p }) {
      return { content: truncate(fs.readFileSync(inWorkspace(p), "utf8"), 30_000) };
    },
  }),
  tool({
    name: "write_file",
    description: "Write a text file in your workspace (creates folders as needed).",
    input: z.object({ path: z.string(), content: z.string() }),
    risk: "write",
    activity: (i) => `Writing ${path.basename(i.path)}`,
    async execute({ path: p, content }) {
      const abs = inWorkspace(p);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      return { written: path.relative(config.paths.workspace, abs), bytes: Buffer.byteLength(content) };
    },
  }),
  tool({
    name: "list_files",
    description: "List files in a workspace folder.",
    input: z.object({ path: z.string().default(".") }),
    risk: "read",
    activity: () => "Looking at files",
    async execute({ path: p }) {
      return fs.readdirSync(inWorkspace(p), { withFileTypes: true }).map((d) => (d.isDirectory() ? d.name + "/" : d.name));
    },
  }),

  // ----- talking back -----
  tool({
    name: "present",
    description: `Show a one-off interactive view inline in the conversation, written in Agentable Lang (see "Agentable Lang" in your instructions). Use it whenever structure beats prose: comparisons, options, plans, numbers, sources, next steps. Buttons that should reply to you use @Say("…"). Keep surrounding text to a sentence or two. For something the user will come back to or keep updating (a tracker, list, plan, log), create an artifact instead.`,
    input: z.object({ title: z.string().optional(), program: z.string().describe("Agentable Lang program; first line defines root") }),
    risk: "read",
    mainOnly: true,
    activity: () => "Preparing a view",
    async execute({ program }) {
      const issues = checkProgram(program);
      if (issues.length) throw new Error(`The view has problems — fix and call present again:\n${formatIssues(issues)}`);
      return { shown: true };
    },
  }),

  // ----- artifacts: persistent apps people, Bits and browser agents share -----
  tool({
    name: "artifact_create",
    description: `Create an artifact: a small persistent app the user keeps (habit tracker, trip planner, reading list, budget, packing list, decision matrix, meal plan, CRM of people…). It has:
- program: the view in Agentable Lang, reading $data.* and calling actions with @Tool("action_name", {…}); $ui.* for local view state.
- data: the initial JSON data.
- actions: named, data-only operations, e.g. {"add_item":{"description":"Add an item","input":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]},"ops":[{"op":"push","path":"items","value":{"text":"$input.text","done":false,"added":"$now"}}]},"toggle_item":{"description":"Check or uncheck an item","input":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]},"ops":[{"op":"toggle","path":"items[id=$input.id].done"}]}}
  Ops: set | merge | push | remove | increment | toggle on paths like "items", "trip.days", "items[id=$input.id].done". Values may use $input, $input.field, $id, $now. Pushed objects get an "id" automatically.
  Add "notify": true to an action that should wake you (e.g. a form submit); "confirm": true if an agent must ask before running it.
Every action becomes a button handler, a tool you can call (artifact_run), and a WebMCP tool browser agents can call. The artifact appears inline and in the user's Artifacts shelf.`,
    input: z.object({
      title: z.string(),
      kind: z.string().describe("use-case type: tracker | planner | list | log | dashboard | form | board | other"),
      description: z.string(),
      icon: z.string().optional().describe("lucide icon name"),
      program: z.string(),
      data: z.record(z.string(), z.unknown()),
      actions: z.record(z.string(), z.object({
        description: z.string(),
        input: z.record(z.string(), z.unknown()).optional(),
        ops: z.array(z.object({ op: z.enum(["set", "merge", "push", "remove", "increment", "toggle"]), path: z.string(), value: z.unknown().optional(), by: z.number().optional() })).min(1),
        confirm: z.boolean().optional(),
        notify: z.boolean().optional(),
      })),
    }),
    risk: "write",
    mainOnly: true,
    activity: (i) => `Building ${i.title ?? "an artifact"}`,
    async execute(i, ctx) {
      const a = ctx.artifacts.create({ ...i, actions: i.actions as any, conversationId: ctx.conversationId });
      return { id: a.id, title: a.title, version: a.version, actions: Object.keys(a.actions) };
    },
  }),
  tool({
    name: "artifact_update",
    description: "Change an artifact's view (program), title, description or actions. Data is kept; change data with artifact_data or artifact_run.",
    input: z.object({
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      program: z.string().optional(),
      actions: z.record(z.string(), z.any()).optional(),
    }),
    risk: "write",
    activity: () => "Updating an artifact",
    async execute({ id, ...patch }, ctx) {
      const a = ctx.artifacts.update(id, patch as any);
      return { id: a.id, version: a.version, actions: Object.keys(a.actions) };
    },
  }),
  tool({
    name: "artifact_run",
    description: "Run one of an artifact's declared actions, exactly as if the user pressed its button.",
    input: z.object({ id: z.string(), action: z.string(), input: z.record(z.string(), z.unknown()).optional() }),
    risk: "write",
    activity: (i) => `Updating ${i.id?.replace(/-[a-z0-9]{6}$/, "") ?? "artifact"}`,
    async execute({ id, action, input }, ctx) {
      const { dataVersion } = await ctx.artifacts.runAction(id, action, input ?? {}, "bits");
      return { ok: true, dataVersion };
    },
  }),
  tool({
    name: "artifact_data",
    description: "Edit an artifact's data directly with ops (set | merge | push | remove | increment | toggle), for changes no declared action covers.",
    input: z.object({
      id: z.string(),
      ops: z.array(z.object({ op: z.enum(["set", "merge", "push", "remove", "increment", "toggle"]), path: z.string(), value: z.unknown().optional(), by: z.number().optional() })).min(1),
    }),
    risk: "write",
    activity: () => "Editing artifact data",
    async execute({ id, ops }, ctx) {
      const { dataVersion } = ctx.artifacts.patchData(id, ops as any);
      return { ok: true, dataVersion };
    },
  }),
  tool({
    name: "artifact_get",
    description: "Read an artifact: its view program, current data, actions and recent activity (who changed what).",
    input: z.object({ id: z.string() }),
    risk: "read",
    activity: () => "Opening an artifact",
    async execute({ id }, ctx) {
      const a = ctx.artifacts.get(id);
      const data = JSON.stringify(a.data);
      return {
        id: a.id,
        title: a.title,
        kind: a.kind,
        version: a.version,
        actions: Object.fromEntries(Object.entries(a.actions).map(([k, v]) => [k, { description: v.description, input: v.input }])),
        data: data.length > 12_000 ? `${data.slice(0, 12_000)}…(truncated)` : a.data,
        program: a.program,
        recentActivity: ctx.artifacts.activity(id, 15),
      };
    },
  }),
  tool({
    name: "artifact_list",
    description: "List the user's artifacts.",
    input: z.object({}),
    risk: "read",
    activity: () => "Looking at artifacts",
    async execute(_i, ctx) {
      return ctx.artifacts.list().map((a) => ({ id: a.id, title: a.title, kind: a.kind, description: a.description, updatedAt: new Date(a.updatedAt).toISOString() }));
    },
  }),
  tool({
    name: "artifact_delete",
    description: "Delete an artifact (moves it to ~/.bits/trash).",
    input: z.object({ id: z.string() }),
    risk: "destructive",
    activity: () => "Deleting an artifact",
    async execute({ id }, ctx) {
      ctx.artifacts.delete(id);
      return { deleted: id };
    },
  }),
  tool({
    name: "ask_user",
    description:
      "Ask the user a question when you truly need their input (after checking memory). Offer 2–5 short options when possible. This ends your turn; their reply starts a new one.",
    input: z.object({ question: z.string(), options: z.array(z.string()).max(6).optional() }),
    risk: "read",
    mainOnly: true,
    endsTurn: true,
    activity: () => "Waiting for you",
    async execute() {
      return { asked: true };
    },
  }),
  tool({
    name: "spawn_helper",
    description:
      "Hand a self-contained subtask to a helper agent with a fresh context (e.g. 'research X and return a 10-line summary with sources'). Use for big research or parallelizable work so your own context stays small. Several helper calls in one step run in parallel.",
    input: z.object({ task: z.string(), context: z.string().optional().describe("facts the helper needs") }),
    risk: "read",
    mainOnly: true,
    activity: (i) => `Helper: ${i.task.slice(0, 40)}`,
    async execute({ task, context }, ctx) {
      return { report: await ctx.runHelper(task, context, ctx.signal) };
    },
  }),
];

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "page";
  }
}
