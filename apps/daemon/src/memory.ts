import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { config } from "./config.ts";
import type { DB } from "./db.ts";
import { bus } from "./bus.ts";

// What Bits knows lives in plain files the user (and Bits) can read, grep and edit:
//
//   ~/.bits/memory/profile.md        always in the prompt
//   ~/.bits/memory/log/2026-10.md    dated facts, one per line
//   ~/.bits/skills/<name>/SKILL.md   "use this when…" — loaded only when needed
//   ~/.bits/routines/<name>.md       prompt + schedule (cron) in frontmatter
//
// SQLite FTS is only a derived index over these files and is rebuilt on change.

const P = config.paths;

const PROFILE_TEMPLATE = `# Profile

<!-- Bits keeps this file up to date. It is always in Bits' prompt, so keep it short. -->

## About me
- (Bits will fill this in as it learns about you)

## Preferences

## People & places

## Ongoing projects
`;

const SAMPLE_SKILL = `---
name: research-report
description: Use this when the user asks to research, compare, or evaluate options (products, tools, places) and wants a recommendation.
---

# Research report

1. Clarify the decision and constraints from memory first (budget, location, preferences in profile.md). Only ask if truly missing.
2. Run 2–4 focused web searches; open the 3–6 most authoritative pages with web_fetch.
3. Build a comparison: render_ui with a \`table\` (options × criteria) and a \`card\` with your pick and why.
4. Cite sources as \`link\` nodes. Keep the written answer to 3–5 sentences.
5. Save any new durable preference you learned with memory_remember.
`;

const SAMPLE_ROUTINE = `---
schedule: "0 8 * * 1-5"
enabled: false
description: Weekday morning brief
---
Good morning routine. Check my profile and recent memory log, then give me a short brief for today:
weather where I live, anything I said was due today or this week, and one thing worth reading.
Render it as a compact card with a checklist. Keep it under 120 words.
`;

export function initHome() {
  for (const dir of [P.memory, P.log, P.skills, P.routines, P.workspace]) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(P.profile)) fs.writeFileSync(P.profile, PROFILE_TEMPLATE);
  const skillDir = path.join(P.skills, "research-report");
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), SAMPLE_SKILL);
  }
  const routine = path.join(P.routines, "morning-brief.md");
  if (!fs.existsSync(routine) && fs.readdirSync(P.routines).length === 0) fs.writeFileSync(routine, SAMPLE_ROUTINE);
}

// ---------- profile & log ----------

export function readProfile() {
  return fs.existsSync(P.profile) ? fs.readFileSync(P.profile, "utf8") : PROFILE_TEMPLATE;
}

export function writeProfile(content: string) {
  fs.writeFileSync(P.profile, content.endsWith("\n") ? content : content + "\n");
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function remember(fact: string, when = new Date()) {
  const clean = fact.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Empty fact");
  const file = path.join(P.log, `${monthKey(when)}.md`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${monthKey(when)}\n\n`);
  const line = `- ${when.toISOString().slice(0, 10)}: ${clean}`;
  fs.appendFileSync(file, line + "\n");
  return line;
}

/** Remove log lines containing `needle` (the "forget this" command). Returns removed lines. */
export function forget(needle: string) {
  const removed: string[] = [];
  const n = needle.toLowerCase();
  for (const f of fs.readdirSync(P.log).filter((f) => f.endsWith(".md"))) {
    const file = path.join(P.log, f);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const keep = lines.filter((l) => {
      const hit = l.startsWith("- ") && l.toLowerCase().includes(n);
      if (hit) removed.push(l);
      return !hit;
    });
    if (keep.length !== lines.length) fs.writeFileSync(file, keep.join("\n"));
  }
  return removed;
}

export function listLogs() {
  if (!fs.existsSync(P.log)) return [];
  return fs
    .readdirSync(P.log)
    .filter((f) => /^\d{4}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()
    .map((f) => ({
      month: f.slice(0, 7),
      lines: fs.readFileSync(path.join(P.log, f), "utf8").split("\n").filter((l) => l.startsWith("- ")).length,
    }));
}

export function readLog(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Bad month");
  const file = path.join(P.log, `${month}.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/** The most recent N facts across months — a cheap "what's been going on" for the prompt. */
export function recentFacts(n = 25) {
  const out: string[] = [];
  for (const { month } of listLogs()) {
    const lines = readLog(month).split("\n").filter((l) => l.startsWith("- "));
    out.unshift(...lines);
    if (out.length >= n) break;
  }
  return out.slice(-n);
}

// ---------- skills ----------

export interface Skill {
  name: string;
  description: string;
  body: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function listSkills(): Skill[] {
  if (!fs.existsSync(P.skills)) return [];
  return fs
    .readdirSync(P.skills, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(P.skills, d.name, "SKILL.md")))
    .map((d) => readSkill(d.name)!)
    .filter(Boolean);
}

export function readSkill(name: string): Skill | null {
  if (!SLUG.test(name)) return null;
  const file = path.join(P.skills, name, "SKILL.md");
  if (!fs.existsSync(file)) return null;
  const parsed = matter(fs.readFileSync(file, "utf8"));
  return { name, description: String(parsed.data.description ?? ""), body: parsed.content.trim() };
}

export function saveSkill(name: string, description: string, body: string) {
  if (!SLUG.test(name)) throw new Error("Skill names are lowercase-kebab-case");
  const dir = path.join(P.skills, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), matter.stringify(body.trim() + "\n", { name, description }));
}

// ---------- routines ----------

export interface RoutineFile {
  name: string;
  schedule: string;
  enabled: boolean;
  description: string;
  conversation: string;
  prompt: string;
}

export function listRoutineFiles(): RoutineFile[] {
  if (!fs.existsSync(P.routines)) return [];
  return fs
    .readdirSync(P.routines)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const parsed = matter(fs.readFileSync(path.join(P.routines, f), "utf8"));
      return {
        name: f.slice(0, -3),
        schedule: String(parsed.data.schedule ?? ""),
        enabled: parsed.data.enabled !== false,
        description: String(parsed.data.description ?? ""),
        conversation: String(parsed.data.conversation ?? "home"),
        prompt: parsed.content.trim(),
      };
    })
    .filter((r) => r.schedule && r.prompt);
}

export function saveRoutine(r: Omit<RoutineFile, "conversation"> & { conversation?: string }) {
  if (!SLUG.test(r.name)) throw new Error("Routine names are lowercase-kebab-case");
  fs.writeFileSync(
    path.join(P.routines, `${r.name}.md`),
    matter.stringify(r.prompt.trim() + "\n", {
      schedule: r.schedule,
      enabled: r.enabled,
      description: r.description,
      ...(r.conversation && r.conversation !== "home" ? { conversation: r.conversation } : {}),
    }),
  );
}

export function setRoutineEnabled(name: string, enabled: boolean) {
  const r = listRoutineFiles().find((x) => x.name === name);
  if (!r) throw new Error(`No routine ${name}`);
  saveRoutine({ ...r, enabled });
}

export function deleteRoutine(name: string) {
  if (!SLUG.test(name)) throw new Error("Bad routine name");
  fs.rmSync(path.join(P.routines, `${name}.md`), { force: true });
}

// ---------- search index ----------

export function reindex(db: DB) {
  db.exec("DELETE FROM search WHERE source IN ('memory','skill','profile')");
  const ins = db.prepare("INSERT INTO search (source, ref, ts, body) VALUES (?, ?, ?, ?)");
  const now = Date.now();
  readProfile()
    .split(/\n(?=#)/)
    .forEach((section, i) => section.trim() && ins.run("profile", `profile.md#${i}`, now, section));
  for (const { month } of listLogs()) {
    for (const line of readLog(month).split("\n").filter((l) => l.startsWith("- "))) {
      ins.run("memory", `log/${month}.md`, now, line.slice(2));
    }
  }
  for (const s of listSkills()) ins.run("skill", `skills/${s.name}`, now, `${s.name}: ${s.description}\n${s.body}`);
}

export interface SearchHit {
  source: string;
  ref: string;
  snippet: string;
}

export function search(db: DB, query: string, limit = 12): SearchHit[] {
  // Turn free text into a forgiving FTS5 OR-query of quoted terms.
  const terms = query
    .toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu)
    ?.slice(0, 12)
    .map((t) => `"${t}"`);
  if (!terms?.length) return [];
  const rows = db
    .prepare(
      `SELECT source, ref, snippet(search, 3, '«', '»', '…', 24) AS snippet
       FROM search WHERE search MATCH ? ORDER BY bm25(search) LIMIT ?`,
    )
    .all(terms.join(" OR "), limit) as { source: string; ref: string; snippet: string }[];
  return rows.map((r) => ({ ...r }));
}

// ---------- watching ----------

export function watchHome(onChange: () => void) {
  let timer: NodeJS.Timeout | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      onChange();
      bus.emit({ type: "memory" });
    }, 250);
  };
  const watchers = [P.memory, P.skills, P.routines].map((dir) => {
    try {
      return fs.watch(dir, { recursive: true }, fire);
    } catch {
      return null;
    }
  });
  return () => watchers.forEach((w) => w?.close());
}
