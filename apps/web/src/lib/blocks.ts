import type { AskUserInput, Message, ToolCallPart, ToolResultPart } from "@bits/protocol";
import type { PendingMessage } from "../store/chat";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  result?: ToolResultPart;
  /** Set when any result for this call asked for a human decision. */
  approval?: { approvalId: string; reason: string; resolved: boolean };
}

export type AssistantItem =
  | { kind: "text"; key: string; text: string }
  | { kind: "ui"; key: string; part: ToolCallPart }
  | { kind: "ask"; key: string; input: AskUserInput; callId: string; answered: boolean }
  | { kind: "tools"; key: string; steps: ToolCall[][] }
  | { kind: "approval"; key: string; call: ToolCall };

export type Block =
  | { kind: "user"; key: string; text: string; source?: string; pending?: PendingMessage; steering?: boolean }
  | { kind: "event"; key: string; text: string; source?: string }
  | { kind: "assistant"; key: string; turnId: string | null; items: AssistantItem[]; live?: string; running?: boolean };

export function textOf(m: Message): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n")
    .trim();
}

export function needsApproval(output: unknown): { approvalId: string; reason: string } | null {
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (o.status === "needs_approval" && typeof o.approvalId === "string") {
      return { approvalId: o.approvalId, reason: typeof o.reason === "string" ? o.reason : "" };
    }
  }
  return null;
}

/** Turn persisted messages (+ optimistic + live text) into render blocks. */
export function buildBlocks(
  messages: Message[],
  opts: {
    pending?: PendingMessage[];
    live?: { turnId: string; text: string };
    runningTurnId?: string | null;
  } = {},
): Block[] {
  // Pair results with calls. Later results for the same call win.
  const results = new Map<string, ToolResultPart>();
  const approvals = new Map<string, { approvalId: string; reason: string }>();
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type !== "tool-result") continue;
      results.set(p.toolCallId, p);
      const na = needsApproval(p.output);
      if (na) approvals.set(p.toolCallId, na);
    }
  }

  // Index of the last user message, to know which ask_user prompts were answered.
  let lastUserSeq = -1;
  for (const m of messages) if (m.role === "user") lastUserSeq = m.seq;
  if (opts.pending?.length) lastUserSeq = Number.MAX_SAFE_INTEGER;

  const blocks: Block[] = [];
  let current: Extract<Block, { kind: "assistant" }> | null = null;

  const pushItem = (item: AssistantItem) => current!.items.push(item);
  const lastToolsRun = () => {
    const last = current!.items[current!.items.length - 1];
    return last?.kind === "tools" ? last : null;
  };

  for (const m of messages) {
    if (m.role === "user") {
      current = null;
      blocks.push({ kind: "user", key: m.id, text: textOf(m), source: m.meta?.source, steering: !!m.meta?.steering });
      continue;
    }
    if (m.role === "event") {
      current = null;
      blocks.push({ kind: "event", key: m.id, text: textOf(m) || "Something happened", source: m.meta?.source });
      continue;
    }
    if (m.role === "tool") continue;
    if (m.meta?.summary) {
      current = null;
      blocks.push({ kind: "event", key: m.id, text: "Conversation summarized", source: "system" });
      continue;
    }

    // assistant
    const turnId = m.turnId ?? null;
    if (!current || (turnId && current.turnId && turnId !== current.turnId)) {
      current = { kind: "assistant", key: m.id, turnId, items: [] };
      blocks.push(current);
    }
    if (!current.turnId) current.turnId = turnId;

    let stepCalls: ToolCall[] | null = null;
    m.parts.forEach((p, i) => {
      const key = `${m.id}:${i}`;
      if (p.type === "text") {
        if (p.text.trim()) pushItem({ kind: "text", key, text: p.text });
        stepCalls = null;
      } else if (p.type === "tool-call") {
        if (p.toolName === "render_ui") {
          pushItem({ kind: "ui", key, part: p });
          stepCalls = null;
        } else if (p.toolName === "ask_user") {
          pushItem({ kind: "ask", key, input: p.input as AskUserInput, callId: p.toolCallId, answered: lastUserSeq > m.seq });
          stepCalls = null;
        } else {
          const result = results.get(p.toolCallId);
          const na = approvals.get(p.toolCallId);
          const call: ToolCall = {
            id: p.toolCallId,
            name: p.toolName,
            input: p.input,
            result,
            approval: na ? { ...na, resolved: !!result && !needsApproval(result.output) } : undefined,
          };
          if (!stepCalls) {
            const run = lastToolsRun();
            stepCalls = [];
            if (run) run.steps.push(stepCalls);
            else pushItem({ kind: "tools", key, steps: [stepCalls] });
          }
          stepCalls.push(call);
          if (call.approval) pushItem({ kind: "approval", key: `${key}:approval`, call });
          // Keep chips of this step together but after an approval card start a fresh run.
          if (call.approval) stepCalls = null;
        }
      }
    });
  }

  // Optimistic user messages that haven't been persisted yet.
  const persisted = new Set(messages.map((m) => m.id));
  for (const p of opts.pending ?? []) {
    if (persisted.has(p.id)) continue;
    current = null;
    blocks.push({ kind: "user", key: p.id, text: p.text, source: p.source, pending: p });
  }

  // Live streaming text.
  const live = opts.live;
  const lastBlock = blocks[blocks.length - 1];
  if (live?.text) {
    if (lastBlock?.kind === "assistant" && (!lastBlock.turnId || lastBlock.turnId === live.turnId)) lastBlock.live = live.text;
    else blocks.push({ kind: "assistant", key: `live:${live.turnId}`, turnId: live.turnId, items: [], live: live.text });
  }

  if (opts.runningTurnId !== undefined && opts.runningTurnId !== null) {
    const tail = blocks[blocks.length - 1];
    if (tail?.kind === "assistant" && (!tail.turnId || tail.turnId === opts.runningTurnId)) tail.running = true;
  }
  return blocks;
}
