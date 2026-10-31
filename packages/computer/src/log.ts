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

export const LOG_VERSION = 1;

/** Who decided on a held write, and why. */
export interface Decision {
  decision: "allow" | "deny";
  /** e.g. "you", "sentinel", "policy" */
  by?: string;
  reason?: string;
}

export type LogEntry =
  | {
      kind: "act";
      act: string;
      at: string;
      url: string;
      steps: number;
      /** What the agent was trying to do, in the user's words, when the caller knows it. */
      task?: string;
      /** Links back to the conversation turn that asked for this. */
      turn?: string;
    }
  | {
      kind: "step";
      act: string;
      step: number;
      at: string;
      action: string;
      ref?: number;
      /** What was pressed, as the page named it. */
      target?: { role: string; name: string };
      text?: string;
      value?: string;
      ok: boolean;
      error?: string;
      ms: number;
      url: string;
    }
  | {
      kind: "effect";
      act: string;
      step: number;
      at: string;
      type: "write" | "navigate" | "new-tab" | "dialog" | "busy";
      method?: string;
      url?: string;
      /** For writes: sent (nothing checked it), allowed or blocked (it was held first). */
      outcome?: "sent" | "allowed" | "blocked";
      by?: string;
      reason?: string;
      bodyBytes?: number;
      /** Caused by the act after its steps finished (e.g. a debounced save). */
      late?: boolean;
      detail?: string;
    }
  | { kind: "act.end"; act: string; at: string; ok: boolean; done: number; error?: string; ms: number; url: string };

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

const day = (d = new Date()) => d.toISOString().slice(0, 10);

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
