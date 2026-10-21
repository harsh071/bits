import os from "node:os";
import type { ModelMessage, SystemModelMessage } from "ai";
import type { Message, Part } from "@bits/protocol";
import { config } from "../config.ts";
import * as memory from "../memory.ts";
import type { Store } from "../store.ts";
import { isAnthropic } from "../models.ts";
import type { ToolDef } from "./tools.ts";

const CACHE = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

// Prompt layout is ordered from most stable to least stable, so provider prompt caches keep hitting:
//   [tools] → [identity + rules + skills index]  ← cache breakpoint
//           → [profile + recent facts + date]    ← changes when memory changes
//           → [summary of older conversation] → [recent messages] ← cache breakpoint on the last one
export function buildInstructions(tools: ToolDef[], opts: { helper?: boolean } = {}): SystemModelMessage[] {
  const skills = memory.listSkills();
  const connectorTools = tools.filter((t) => t.name.startsWith("mcp__")).map((t) => t.name);
  const stable = opts.helper
    ? HELPER_RULES
    : `${IDENTITY}

${LADDER(connectorTools)}

${MEMORY_RULES}

## Skills
Load a skill with skill_load before doing a task it covers. Available skills:
${skills.length ? skills.map((s) => `- ${s.name}: ${s.description}`).join("\n") : "- (none yet — save one with skill_save after a repeatable multi-step task)"}

${UI_RULES}

${STYLE_RULES}`;

  const now = new Date();
  const facts = memory.recentFacts(30);
  const volatile = `## About the user (profile.md — always current)
${memory.readProfile().trim()}

## Recent memory log
${facts.length ? facts.join("\n") : "(empty)"}

## Environment
Today is ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Host: ${os.type()}. Your workspace: ${config.paths.workspace}`;

  const anthropic = isAnthropic(config.model);
  return [
    { role: "system", content: stable, ...(anthropic ? { providerOptions: CACHE } : {}) },
    { role: "system", content: volatile },
  ];
}

const IDENTITY = `You are Bits, a personal agent that lives with one person and works for them over months.
You are always on: you run on their own computer as a background service, wake up for their messages and for scheduled routines, and keep working while they're away. Messages may arrive mid-task ("also check X", "actually make it Thursday") — fold them in and keep going rather than starting over.
You're warm, quick and capable — a great chief of staff with a light touch. You do things rather than describe how they could be done.`;

const LADDER = (connectors: string[]) => `## Try the cheapest option first
1. What you already know — profile, memory log, skills (memory_search).
2. A connector (app API)${connectors.length ? `: ${connectors.slice(0, 30).join(", ")}` : " — none connected yet"}.
3. Web search (web_search, web_fetch).
4. Your own computer: shell and files in your workspace (run_command, read_file, write_file).
5. Ask the user (ask_user).
If a connector is broken or unauthorized, do NOT work around it with other tools — tell the user what failed and ask.
Some actions pass through a safety reviewer. If an action is denied, don't retry it another way; explain and ask.
For big research or parallel work, use spawn_helper so your context stays focused.`;

const MEMORY_RULES = `## Memory
- profile.md (above) is always in your prompt. Update it with profile_write for core facts (name, home city, work, family, strong preferences).
- When the user tells you something worth knowing next time, save one short dated line with memory_remember — without making a fuss about it.
- Before asking the user anything, check memory_search.
- Never store passwords, keys or card numbers. Honor "forget that" with memory_forget.
- Routines (routine_save) are scheduled prompts to yourself; confirm the schedule in plain words after saving.`;

const UI_RULES = `## Showing things
You can render rich UI inline with render_ui. Prefer it for comparisons, options, plans, schedules, metrics, and sources. Put next steps in an "actions" node so the user can tap instead of type. Keep surrounding prose to a sentence or two and never duplicate what the UI shows.`;

const STYLE_RULES = `## Style
- Lead with the answer or outcome. Short paragraphs. Markdown is fine in text mode.
- When the user's message came by voice (it starts with [voice]), reply in 1–3 short spoken sentences with no markdown, lists or URLs — put details in render_ui instead.
- Routine runs start with [routine: name]; deliver the result directly, as if you're checking in.`;

const HELPER_RULES = `You are a focused helper agent working for Bits, a personal agent. Complete the task you're given using your tools, then reply with a compact report (facts, numbers, source URLs). You cannot talk to the user; make reasonable assumptions and state them. Be efficient: a few targeted searches beat many.`;

// ---------- messages ----------

function toolOutput(output: unknown, isError?: boolean) {
  if (isError) return { type: "error-text" as const, value: typeof output === "string" ? output : JSON.stringify(output) };
  if (typeof output === "string") return { type: "text" as const, value: output };
  return { type: "json" as const, value: (output ?? null) as any };
}

function userText(m: Message) {
  const text = m.parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
  const time = new Date(m.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const tag =
    m.meta?.source === "voice" ? "[voice] " : m.meta?.source === "routine" ? `[routine: ${m.meta.routine ?? "routine"}] ` : "";
  return `${tag}${text}\n<sent>${time}</sent>`;
}

/**
 * Convert the persisted transcript into model messages.
 * - Steering messages that arrived between a tool call and its result are moved after the result
 *   (providers require results to directly follow calls).
 * - Tool calls that never got a result (cancelled / crashed) get a synthetic "interrupted" result.
 */
export function toModelMessages(store: Store, conversationId: string): ModelMessage[] {
  const { summary, upto } = store.getSummary(conversationId);
  const msgs = store.getMessages(conversationId, upto, 100_000);
  const out: ModelMessage[] = [];
  if (summary) {
    out.push({ role: "user", content: `<conversation_summary>\n${summary}\n</conversation_summary>\n(Earlier messages were summarized. Continue naturally.)` });
    out.push({ role: "assistant", content: "Got it — I have the context." });
  }

  let pendingCalls = new Map<string, string>(); // toolCallId -> toolName awaiting result
  let held: ModelMessage[] = [];

  const flushInterrupted = () => {
    if (pendingCalls.size) {
      out.push({
        role: "tool",
        content: [...pendingCalls].map(([toolCallId, toolName]) => ({
          type: "tool-result" as const,
          toolCallId,
          toolName,
          output: toolOutput("Interrupted before this finished.", true),
        })),
      });
      pendingCalls = new Map();
    }
    out.push(...held);
    held = [];
  };

  for (const m of msgs) {
    if (m.role === "event") continue;
    if (m.role === "user") {
      const msg: ModelMessage = { role: "user", content: userText(m) };
      if (pendingCalls.size) held.push(msg);
      else out.push(msg);
      continue;
    }
    if (m.role === "assistant") {
      flushInterrupted();
      const content: any[] = [];
      for (const p of m.parts) {
        if (p.type === "text" && p.text.trim()) content.push({ type: "text", text: p.text });
        if (p.type === "tool-call") {
          content.push({ type: "tool-call", toolCallId: p.toolCallId, toolName: p.toolName, input: p.input ?? {} });
          // Pending until its result message; flushed as "interrupted" if none follows.
          pendingCalls.set(p.toolCallId, p.toolName);
        }
      }
      if (content.length) out.push({ role: "assistant", content });
      continue;
    }
    if (m.role === "tool") {
      const content = m.parts
        .filter((p): p is Extract<Part, { type: "tool-result" }> => p.type === "tool-result")
        .filter((p) => pendingCalls.has(p.toolCallId) && !isApprovalPlaceholder(p.output))
        .map((p) => {
          pendingCalls.delete(p.toolCallId);
          return { type: "tool-result" as const, toolCallId: p.toolCallId, toolName: p.toolName, output: toolOutput(p.output, p.isError) };
        });
      if (content.length) out.push({ role: "tool", content });
      if (!pendingCalls.size) {
        out.push(...held);
        held = [];
      }
    }
  }
  flushInterrupted();

  // Cache breakpoint on the newest message so the whole conversation prefix is reused next step.
  if (isAnthropic(config.model) && out.length) {
    const last = out[out.length - 1] as any;
    last.providerOptions = CACHE;
  }
  return out;
}

/** Rough token estimate (chars/4) for compaction decisions. */
export function estimateTokens(messages: ModelMessage[]) {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

function isApprovalPlaceholder(output: unknown) {
  return !!output && typeof output === "object" && (output as { status?: string }).status === "needs_approval";
}
