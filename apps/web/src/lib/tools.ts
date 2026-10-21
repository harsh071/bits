import {
  AlarmClock,
  Brain,
  FilePen,
  FileText,
  Globe,
  Plug,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { needsApproval, type ToolCall } from "./blocks";

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const field = (input: unknown, ...keys: string[]) => {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  for (const k of keys) if (o[k] != null && o[k] !== "") return str(o[k]);
  return "";
};
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
export const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export const humanize = (name: string) =>
  name
    .replace(/^mcp__/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

function resultCount(output: unknown): number | null {
  if (Array.isArray(output)) return output.length;
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    for (const k of ["results", "items", "matches", "hits"]) if (Array.isArray(o[k])) return (o[k] as unknown[]).length;
  }
  return null;
}

export interface ToolMeta {
  icon: LucideIcon;
  /** Label while running vs. once done. */
  label: string;
  detail?: string;
}

export function isMcpTool(name: string) {
  return name.startsWith("mcp__") || name.startsWith("mcp_") || name.includes("__");
}

export function toolMeta(call: ToolCall): ToolMeta {
  const { name, input, result } = call;
  const done = !!result && !needsApproval(result.output);
  const count = done ? resultCount(result!.output) : null;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  if (name === "web_search") {
    const q = field(input, "query", "q");
    return {
      icon: Search,
      label: done ? "Searched the web" : "Searching the web",
      detail: [q && `“${clip(q, 40)}”`, count != null && plural(count, "result")].filter(Boolean).join(" · "),
    };
  }
  if (name === "web_fetch") {
    const url = field(input, "url");
    return { icon: Globe, label: done ? "Read" : "Reading", detail: url ? host(url) : undefined };
  }
  if (name.startsWith("memory_")) {
    const op = name.slice(7);
    const writes = /write|append|save|update|add|remember|edit|forget|delete/.test(op);
    return {
      icon: Brain,
      label: writes ? (done ? "Updated memory" : "Updating memory") : done ? "Checked memory" : "Checking memory",
      detail: clip(field(input, "query", "path", "file", "section", "text", "content"), 40) || undefined,
    };
  }
  if (name.startsWith("skill_")) {
    const skill = field(input, "name", "skill");
    const op = name.slice(6);
    const verb = op === "create" || op === "write" ? (done ? "Wrote skill" : "Writing skill") : done ? "Used skill" : "Using skill";
    return { icon: Sparkles, label: verb, detail: skill || undefined };
  }
  if (name.startsWith("routine_")) {
    const r = field(input, "name", "routine");
    const op = name.slice(8);
    const verbs: Record<string, [string, string]> = {
      create: ["Setting up routine", "Set up routine"],
      update: ["Updating routine", "Updated routine"],
      delete: ["Removing routine", "Removed routine"],
      list: ["Checking routines", "Checked routines"],
      run: ["Running routine", "Ran routine"],
    };
    const [ing, ed] = verbs[op] ?? [`${humanize(op)} routine`, `${humanize(op)} routine`];
    return { icon: AlarmClock, label: done ? ed : ing, detail: r || undefined };
  }
  if (name === "run_command") {
    const cmd = field(input, "command", "cmd");
    return { icon: SquareTerminal, label: done ? "Ran" : "Running", detail: cmd ? clip(cmd, 44) : "a command" };
  }
  if (name === "read_file") {
    const p = field(input, "path", "file");
    return { icon: FileText, label: done ? "Read" : "Reading", detail: p ? base(p) : "a file" };
  }
  if (name === "write_file") {
    const p = field(input, "path", "file");
    return { icon: FilePen, label: done ? "Wrote" : "Writing", detail: p ? base(p) : "a file" };
  }
  if (isMcpTool(name)) {
    const parts = name.replace(/^mcp_+/, "").split("__");
    const tool = humanize(parts.pop() ?? name);
    const server = parts.length ? humanize(parts.join(" ")) : undefined;
    return { icon: Plug, label: tool, detail: server };
  }
  return { icon: Wrench, label: humanize(name) };
}

/** Friendly one-liner for approval cards. */
export function summarizeInput(name: string, input: unknown): string {
  const m = toolMeta({ id: "", name, input, result: { type: "tool-result", toolCallId: "", toolName: name, output: null } });
  if (name === "run_command") return field(input, "command", "cmd");
  if (name === "write_file" || name === "read_file") return field(input, "path", "file");
  return [m.label, m.detail].filter(Boolean).join(" · ");
}
