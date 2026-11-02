// The action log: every step Bits takes in the browser and everything that step caused.
//
// One JSON object per line, one file per day: ~/.bits/actions/YYYY-MM-DD.jsonl.
// Plain files you can read, grep, delete, or hand to RUI to score.
//
// Each effect points at the step that caused it (`act` + `step`), so the log answers
// "what did this click actually send?", not just "what was clicked".
//
// Privacy: only Bits' own actions are logged, never your own browsing. Request bodies are
// not stored (only their size), URLs keep host + path (query strings can hold tokens),
// and text typed into password fields is replaced with "•••".

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ActionLogEntry, WriteDecisionInfo } from "@bits/protocol";

export const LOG_VERSION = 1;

export type Decision = WriteDecisionInfo;
export type LogEntry = ActionLogEntry;

export type LogSink = (e: LogEntry & { v: number }) => void;

/** host + path, without query or fragment. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol.startsWith("http") ? `${u.protocol}//${u.host}${u.pathname}` : `${u.protocol}${u.pathname}`.slice(0, 200);
  } catch {
    return url.slice(0, 200);
  }
}

/** Local calendar day, so "today" matches your clock. */
const day = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Appends entries to <dir>/<YYYY-MM-DD>.jsonl. */
export class ActionLog {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  write: LogSink = (e) => {
    appendFileSync(path.join(this.dir, `${day(new Date(e.at))}.jsonl`), JSON.stringify(e) + "\n", { mode: 0o600 });
  };

  days(): string[] {
    return readdirSync(this.dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
  }

  read(date = day()): (LogEntry & { v: number })[] {
    const file = path.join(this.dir, `${date}.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return []; // a line cut off by a crash
        }
      });
  }
}

/** The log as a readable timeline. */
export function formatTimeline(entries: LogEntry[]): string {
  const out: string[] = [];
  const time = (at: string) => new Date(at).toLocaleTimeString([], { hour12: false });
  const short = (u?: string) => (u ?? "").replace(/^https?:\/\//, "");
  for (const e of entries) {
    if (e.kind === "act") {
      out.push("", `${time(e.at)}  ${e.task ? JSON.stringify(e.task) : "act"}  ·  ${short(e.url)}  ·  ${e.steps} step(s)  [${e.act}]`);
    } else if (e.kind === "step") {
      const what = e.target ? `${e.target.role} ${JSON.stringify(e.target.name)}` : e.ref !== undefined ? `[${e.ref}]` : "";
      const extra = e.text !== undefined ? ` ← ${JSON.stringify(e.text)}` : e.value !== undefined ? ` = ${JSON.stringify(e.value)}` : "";
      out.push(`  ${e.ok ? "✓" : "✗"} ${e.step + 1}. ${e.action} ${what}${extra}  ${e.ms}ms${e.error ? `\n       ${e.error}` : ""}`);
    } else if (e.kind === "effect") {
      if (e.type === "write") {
        const mark = e.outcome === "blocked" ? "⛔ blocked" : e.outcome === "allowed" ? "⏸ → sent" : "→ sent";
        const who = e.by ? ` by ${e.by}${e.reason ? `: ${e.reason}` : ""}` : "";
        out.push(`       ${mark} ${e.method} ${short(e.url)}${who}${e.late ? " (after the steps)" : ""}`);
      } else out.push(`       · ${e.type}${e.url ? ` ${short(e.url)}` : ""}${e.detail ? ` ${e.detail}` : ""}`);
    } else if (e.kind === "act.end") {
      out.push(`  ${e.ok ? "done" : "stopped"} in ${e.ms}ms${e.error ? ` — ${e.error}` : ""}`);
    }
  }
  return out.join("\n").trim();
}
