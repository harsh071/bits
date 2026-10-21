import { generateText, jsonSchema, streamText, tool as aiTool, isStepCount, type ModelMessage, type ToolSet } from "ai";
import type { Message, Part, SendMessageBody, SendMessageResult, ToolCallPart, Turn } from "@bits/protocol";
import { z } from "zod";
import { bus } from "../bus.ts";
import { config } from "../config.ts";
import * as memory from "../memory.ts";
import { resolveModel } from "../models.ts";
import type { Store } from "../store.ts";
import type { Artifacts } from "../artifacts.ts";
import type { ArtifactActivity, ArtifactMeta } from "@bits/protocol";
import { buildInstructions, estimateTokens, toModelMessages } from "./context.ts";
import { alwaysAllow, review } from "./sentinel.ts";
import { builtinTools, type ToolDef } from "./tools.ts";

const LEASE_MS = 30_000;
const MID_TURN_COMPACT_TOKENS = 150_000;

type CallResult = { output: unknown; isError: boolean } | "wait";

/**
 * The agent runtime.
 *
 * - One queue per conversation: at most one turn runs per conversation; others wait as "queued".
 * - A turn is a loop of steps (model call → tool calls → model call …). Every step is written to the
 *   database before the next begins, so the transcript itself is the durable journal: after a crash
 *   the turn's lease expires, a worker picks it up, and it continues from the last saved step.
 * - Tool results are also recorded by tool call id, so a tool never runs twice for the same call.
 * - Messages that arrive mid-turn steer the running turn instead of starting a new one.
 */
export class Runtime {
  private workers = new Map<string, { turnId: string; ctrl: AbortController }>();
  private compactTimers = new Map<string, NodeJS.Timeout>();
  private ticker: NodeJS.Timeout | null = null;
  extraTools: ToolDef[] = [];
  /** Returns ms until the next routine fires (used to skip compaction when the agent will wake anyway). */
  nextRoutineInMs: () => number | null = () => null;

  readonly store: Store;
  readonly artifacts: Artifacts;
  constructor(store: Store, artifacts: Artifacts) {
    this.store = store;
    this.artifacts = artifacts;
    artifacts.onNotify = (meta, action, input, by) => this.notifyFromArtifact(meta, action, input, by);
  }

  get tools(): ToolDef[] {
    return [...builtinTools, ...this.extraTools];
  }

  start() {
    // We are the only daemon on this machine: anything still "running" belongs to a dead process.
    this.store.db.exec("UPDATE turns SET lease_until = 0 WHERE status = 'running'");
    this.ticker = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop() {
    if (this.ticker) clearInterval(this.ticker);
    for (const w of this.workers.values()) w.ctrl.abort(new Error("shutdown"));
    for (const t of this.compactTimers.values()) clearTimeout(t);
    this.compactTimers.clear();
  }

  private tick() {
    for (const turn of this.store.claimableTurns()) {
      if (this.workers.has(turn.conversationId)) continue;
      void this.run(turn);
    }
  }

  // ---------- inputs ----------

  sendMessage(conversationId: string, body: SendMessageBody): SendMessageResult {
    const text = body.text?.trim();
    if (!text) throw new Error("Empty message");
    const active = this.store.activeTurn(conversationId);
    const { message, duplicate } = this.store.appendMessage({
      id: body.id,
      conversationId,
      role: "user",
      parts: [{ type: "text", text }],
      meta: { source: body.source === "voice" ? "voice" : "app", ...(active ? { steering: true } : {}) },
    });
    if (duplicate) return { message, duplicate, turnId: active?.id ?? null, steering: false };

    this.cancelCompaction(conversationId);
    if (active) {
      if (active.status === "waiting") {
        // A new message instead of an approval: decline what was pending and let the turn read the message.
        for (const a of this.store.listApprovals("pending").filter((a) => a.turnId === active.id)) {
          this.store.decideApproval(a.id, "denied");
        }
        this.store.updateTurn(active.id, { status: "queued" });
        this.tick();
      }
      return { message, duplicate, turnId: active.id, steering: true };
    }
    const turn = this.store.createTurn(conversationId, "message", message.seq - 1);
    this.maybeTitle(conversationId, text);
    this.tick();
    return { message, duplicate, turnId: turn.id, steering: false };
  }

  /** An artifact action marked notify:true ran — tell Bits, in the artifact's conversation. */
  notifyFromArtifact(meta: ArtifactMeta, action: string, input: unknown, by: ArtifactActivity["by"]) {
    const conversationId = this.store.getConversation(meta.conversationId) ? meta.conversationId : "home";
    const who = by === "person" ? "The user" : by === "agent" ? "A browser agent" : "Bits";
    const text = `${who} ran "${action}" on the artifact "${meta.title}" (${meta.id}) with ${JSON.stringify(input).slice(0, 1500)}. React if anything needs doing.`;
    const active = this.store.activeTurn(conversationId);
    const { message } = this.store.appendMessage({
      conversationId,
      role: "user",
      parts: [{ type: "text", text }],
      meta: { source: "artifact", artifact: meta.id, ...(active ? { steering: true } : {}) },
    });
    if (active) return;
    this.store.createTurn(conversationId, "webhook", message.seq - 1);
    this.tick();
  }

  startRoutine(name: string) {
    const r = memory.listRoutineFiles().find((x) => x.name === name);
    if (!r) throw new Error(`No routine ${name}`);
    const conversationId = this.store.getConversation(r.conversation) ? r.conversation : "home";
    const active = this.store.activeTurn(conversationId);
    this.store.appendMessage({ conversationId, role: "event", parts: [{ type: "text", text: `Routine “${r.description || r.name}” started` }] });
    const { message } = this.store.appendMessage({
      conversationId,
      role: "user",
      parts: [{ type: "text", text: r.prompt }],
      meta: { source: "routine", routine: r.name },
    });
    if (active) return active.id; // folds into the running turn as steering
    const turn = this.store.createTurn(conversationId, "routine", message.seq - 1);
    this.tick();
    return turn.id;
  }

  cancel(conversationId: string) {
    const w = this.workers.get(conversationId);
    if (w) w.ctrl.abort(new Error("cancelled"));
    const active = this.store.activeTurn(conversationId);
    if (active && !w) this.store.updateTurn(active.id, { status: "cancelled" });
  }

  decideApproval(id: string, decision: "approve" | "deny" | "always") {
    const approval = this.store.decideApproval(id, decision === "deny" ? "denied" : "approved");
    if (!approval) return null;
    if (decision === "always") alwaysAllow(approval.toolName);
    const turn = this.store.getTurn(approval.turnId);
    const stillPending = this.store.listApprovals("pending").some((a) => a.turnId === approval.turnId);
    if (turn?.status === "waiting" && !stillPending) {
      this.store.updateTurn(turn.id, { status: "queued" });
      this.tick();
    }
    return approval;
  }

  // ---------- the turn ----------

  private async run(turn: Turn) {
    const ctrl = new AbortController();
    const { conversationId } = turn;
    this.workers.set(conversationId, { turnId: turn.id, ctrl });
    this.store.updateTurn(turn.id, { status: "running", leaseUntil: Date.now() + LEASE_MS }, "Thinking");
    const lease = setInterval(() => {
      const cur = this.store.getTurn(turn.id);
      if (cur?.status === "running") this.store.db.prepare("UPDATE turns SET lease_until = ? WHERE id = ?").run(Date.now() + LEASE_MS, turn.id);
    }, LEASE_MS / 3);
    try {
      const outcome = await this.loop(turn, ctrl.signal);
      this.store.updateTurn(turn.id, { status: outcome });
    } catch (err: any) {
      if (ctrl.signal.aborted) {
        this.store.updateTurn(turn.id, { status: "cancelled" });
        if (String(ctrl.signal.reason?.message) !== "shutdown") {
          this.store.appendMessage({ conversationId, role: "event", turnId: turn.id, parts: [{ type: "text", text: "Stopped" }] });
        } else {
          // Shutting down mid-turn: leave it resumable.
          this.store.updateTurn(turn.id, { status: "queued" });
        }
      } else {
        console.error(`[bits] turn ${turn.id} failed:`, err);
        this.store.updateTurn(turn.id, { status: "failed", error: String(err?.message ?? err) });
        this.store.appendMessage({
          conversationId,
          role: "event",
          turnId: turn.id,
          parts: [{ type: "text", text: `Something went wrong: ${String(err?.message ?? err).slice(0, 300)}` }],
        });
      }
    } finally {
      clearInterval(lease);
      this.workers.delete(conversationId);
      this.scheduleCompaction(conversationId);
      setImmediate(() => this.tick());
    }
  }

  private async loop(turn: Turn, signal: AbortSignal): Promise<"done" | "waiting"> {
    const { conversationId } = turn;
    let steps = turn.steps;
    const tools = this.tools;
    const byName = new Map(tools.map((t) => [t.name, t]));

    while (true) {
      signal.throwIfAborted();

      // 1) Finish any tool calls this turn already decided on (also the crash-resume path).
      const pending = this.pendingToolCalls(conversationId, turn.id);
      if (pending.length) {
        const results = await Promise.all(pending.map((call) => this.executeCall(call, byName.get(call.toolName), turn, signal)));
        const finished: Part[] = [];
        let waiting = false;
        let ends = false;
        results.forEach((r, i) => {
          const call = pending[i];
          if (r === "wait") {
            waiting = true;
            const approval = this.store.approvalForCall(call.toolCallId)!;
            finished.push({
              type: "tool-result",
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output: { status: "needs_approval", approvalId: approval.id, reason: approval.reason },
            });
          } else {
            finished.push({ type: "tool-result", toolCallId: call.toolCallId, toolName: call.toolName, output: r.output, isError: r.isError });
            if (byName.get(call.toolName)?.endsTurn && !r.isError) ends = true;
          }
        });
        const fresh = finished.filter((p) => !this.alreadyRecorded(conversationId, turn.id, p));
        if (fresh.length) this.store.appendMessage({ conversationId, role: "tool", turnId: turn.id, parts: fresh });
        if (waiting) {
          this.store.updateTurn(turn.id, { status: "waiting" }, "Needs your OK");
          return "waiting";
        }
        if (ends) return "done";
        continue;
      }

      // 2) Model step.
      if (steps >= config.maxSteps) {
        this.store.appendMessage({
          conversationId,
          role: "assistant",
          turnId: turn.id,
          parts: [{ type: "text", text: `I've taken ${steps} steps on this, so I'm pausing to check in. Say "keep going" and I'll continue.` }],
        });
        return "done";
      }

      const seenSeq = this.store.getConversation(conversationId)!.lastSeq;
      this.store.setTurnSeen(turn.id, seenSeq);
      let messages = toModelMessages(this.store, conversationId);
      if (estimateTokens(messages) > MID_TURN_COMPACT_TOKENS) {
        this.store.updateTurn(turn.id, {}, "Tidying up context");
        await this.compact(conversationId, { force: true });
        messages = toModelMessages(this.store, conversationId);
      }

      this.store.updateTurn(turn.id, { steps, leaseUntil: Date.now() + LEASE_MS }, "Thinking");
      const result = streamText({
        model: resolveModel(config.model),
        instructions: buildInstructions(tools),
        messages,
        tools: this.modelTools(tools),
        abortSignal: signal,
        maxOutputTokens: 8192,
      });

      for await (const part of result.stream as AsyncIterable<any>) {
        if (part.type === "text-delta") {
          const text = part.text ?? part.delta ?? "";
          if (text) bus.emit({ type: "delta", conversationId, turnId: turn.id, text });
        } else if (part.type === "tool-input-start" && part.toolName) {
          const def = byName.get(part.toolName);
          this.store.updateTurn(turn.id, {}, def ? safeActivity(def, {}) : "Working");
        } else if (part.type === "error") {
          throw part.error instanceof Error ? part.error : new Error(String(part.error?.message ?? part.error));
        }
      }

      const content = (await result.content) as any[];
      const parts: Part[] = [];
      for (const c of content) {
        if (c.type === "text" && c.text) {
          const prev = parts[parts.length - 1];
          if (prev?.type === "text") prev.text += c.text;
          else parts.push({ type: "text", text: c.text });
        } else if (c.type === "reasoning" && c.text) {
          parts.push({ type: "reasoning", text: c.text });
        } else if (c.type === "tool-call") {
          parts.push({ type: "tool-call", toolCallId: c.toolCallId, toolName: c.toolName, input: c.input ?? {} });
        }
      }
      steps++;
      if (parts.length) this.store.appendMessage({ conversationId, role: "assistant", turnId: turn.id, parts });
      this.store.updateTurn(turn.id, { steps, leaseUntil: Date.now() + LEASE_MS });

      if (!parts.some((p) => p.type === "tool-call")) {
        // Steering: if the user said something while we were writing, go around again.
        const steered = this.store.getMessages(conversationId, seenSeq).some((m) => m.role === "user");
        if (steered) continue;
        return "done";
      }
    }
  }

  /** Tool calls from this turn's assistant messages that have no final result yet. */
  private pendingToolCalls(conversationId: string, turnId: string): ToolCallPart[] {
    const msgs = this.store.getMessages(conversationId, 0, 100_000).filter((m) => m.turnId === turnId);
    const calls: ToolCallPart[] = [];
    const done = new Set<string>();
    for (const m of msgs) {
      for (const p of m.parts) {
        if (p.type === "tool-call") calls.push(p);
        if (p.type === "tool-result" && !isPlaceholder(p.output)) done.add(p.toolCallId);
      }
    }
    return calls.filter((c) => !done.has(c.toolCallId));
  }

  private alreadyRecorded(conversationId: string, turnId: string, part: Part) {
    if (part.type !== "tool-result" || !isPlaceholder(part.output)) return false;
    // Don't write the same "needs approval" placeholder twice when a waiting turn is re-checked.
    return this.store
      .getMessages(conversationId, 0, 100_000)
      .some((m) => m.turnId === turnId && m.parts.some((p) => p.type === "tool-result" && p.toolCallId === part.toolCallId));
  }

  private async executeCall(call: ToolCallPart, def: ToolDef | undefined, turn: Turn, signal: AbortSignal): Promise<CallResult> {
    if (!def) return { output: `Unknown tool ${call.toolName}`, isError: true };
    const cached = this.store.getToolRun(call.toolCallId);
    if (cached) return cached;

    const approval = this.store.approvalForCall(call.toolCallId);
    if (approval?.status === "pending") return "wait";
    if (approval?.status === "denied") {
      const out = { output: "The user declined this action. Don't retry it another way; ask what they'd like instead.", isError: true };
      this.store.saveToolRun(call.toolCallId, turn.id, call.toolName, out.output, true);
      return out;
    }
    if (!approval) {
      const verdict = await review(def, call.input, this.store, turn.conversationId);
      if (verdict.action === "deny") return { output: verdict.reason, isError: true };
      if (verdict.action === "ask") {
        this.store.createApproval({
          turnId: turn.id,
          conversationId: turn.conversationId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
          reason: verdict.reason,
        });
        return "wait";
      }
    }

    let input = call.input;
    if (def.input instanceof z.ZodType) {
      const parsed = def.input.safeParse(call.input);
      if (!parsed.success) return { output: `Invalid input: ${parsed.error.message}`, isError: true };
      input = parsed.data;
    }
    this.store.updateTurn(turn.id, {}, safeActivity(def, input));
    let output: unknown;
    let isError = false;
    try {
      output = await def.execute(input, {
        store: this.store,
        artifacts: this.artifacts,
        conversationId: turn.conversationId,
        turnId: turn.id,
        toolCallId: call.toolCallId,
        signal,
        runHelper: (task, context, s) => this.runHelper(task, context, s),
      });
    } catch (err: any) {
      if (signal.aborted) throw err;
      output = String(err?.message ?? err);
      isError = true;
    }
    this.store.saveToolRun(call.toolCallId, turn.id, call.toolName, output, isError);
    return { output, isError };
  }

  private modelTools(defs: ToolDef[], withExecute?: (def: ToolDef) => (input: any, opts: any) => Promise<unknown>): ToolSet {
    const set: ToolSet = {};
    for (const def of defs) {
      set[def.name] = aiTool({
        description: def.description,
        inputSchema: def.input instanceof z.ZodType ? def.input : jsonSchema(def.input.jsonSchema as any),
        ...(withExecute ? { execute: withExecute(def) } : {}),
      } as any);
    }
    return set;
  }

  // ---------- helpers (subagents with a fresh context) ----------

  async runHelper(task: string, context: string | undefined, signal: AbortSignal): Promise<string> {
    const defs = this.tools.filter((t) => !t.mainOnly);
    const result = await generateText({
      model: resolveModel(config.model),
      instructions: buildInstructions(defs, { helper: true }),
      prompt: context ? `${task}\n\nContext:\n${context}` : task,
      tools: this.modelTools(defs, (def) => async (input) => {
        const verdict = await review(def, input, this.store, "home");
        if (verdict.action !== "run") return { error: `Not allowed without the user's OK (${verdict.reason}). Report this back instead.` };
        try {
          return await def.execute(input, {
            store: this.store,
            artifacts: this.artifacts,
            conversationId: "helper",
            turnId: "helper",
            toolCallId: "helper",
            signal,
            runHelper: async () => "Helpers can't spawn helpers.",
          });
        } catch (e: any) {
          return { error: String(e?.message ?? e) };
        }
      }),
      stopWhen: isStepCount(16),
      abortSignal: signal,
      maxOutputTokens: 4096,
    });
    return result.text || "(the helper finished without a report)";
  }

  // ---------- summarize while you're away ----------

  private scheduleCompaction(conversationId: string) {
    this.cancelCompaction(conversationId);
    this.compactTimers.set(
      conversationId,
      setTimeout(() => {
        this.compactTimers.delete(conversationId);
        const soon = this.nextRoutineInMs();
        if (soon !== null && soon < 5 * 60_000) return; // a routine is about to wake the agent anyway
        if (this.store.activeTurn(conversationId)) return;
        this.compact(conversationId).catch((e) => console.error("[bits] compaction failed:", e));
      }, config.compactAfterMs),
    );
  }

  private cancelCompaction(conversationId: string) {
    const t = this.compactTimers.get(conversationId);
    if (t) clearTimeout(t);
    this.compactTimers.delete(conversationId);
  }

  /**
   * Replace older history with a short summary. Uses the same instructions, tools and message prefix as
   * the last turn so the provider's prompt cache is reused. The last few exchanges are kept word for word.
   */
  async compact(conversationId: string, opts: { force?: boolean } = {}) {
    const messages = toModelMessages(this.store, conversationId);
    if (!opts.force && estimateTokens(messages) < config.compactMinTokens) return false;

    const { upto } = this.store.getSummary(conversationId);
    const all = this.store.getMessages(conversationId, upto, 100_000);
    const userSeqs = all.filter((m) => m.role === "user").map((m) => m.seq);
    if (userSeqs.length < 4) return false;
    const keepFrom = userSeqs[userSeqs.length - 3]; // keep the last 3 exchanges verbatim
    const tools = this.tools;

    const { text } = await generateText({
      model: resolveModel(config.model),
      instructions: buildInstructions(tools),
      tools: this.modelTools(tools),
      toolChoice: "none",
      messages: [
        ...messages,
        {
          role: "user",
          content: `[system] Write a compact summary of this conversation so far for your own future reference. Include: goals and open tasks, decisions made, key facts and numbers, commitments you made, and anything pending on the user. Be dense; no pleasantries.
Then, on separate lines starting with "FACT: ", list durable facts about the user that are NOT already in their profile or memory log (or nothing).`,
        } satisfies ModelMessage,
      ],
      maxOutputTokens: 2000,
    });

    const facts = text.split("\n").filter((l) => l.startsWith("FACT: "));
    for (const f of facts) memory.remember(f.slice(6));
    if (facts.length) memory.reindex(this.store.db);
    const summary = text
      .split("\n")
      .filter((l) => !l.startsWith("FACT: "))
      .join("\n")
      .trim();
    this.store.setSummary(conversationId, summary, keepFrom - 1);
    this.store.appendMessage({ conversationId, role: "event", parts: [{ type: "text", text: "Summarized earlier conversation" }], meta: { summary: true } });
    return true;
  }

  // ---------- titles ----------

  private maybeTitle(conversationId: string, text: string) {
    const conv = this.store.getConversation(conversationId);
    if (!conv || conversationId === "home" || conv.title !== "New conversation") return;
    generateText({
      model: resolveModel(config.fastModel),
      prompt: `Give a 2-5 word title for a conversation that starts with: "${text.slice(0, 400)}". Reply with the title only.`,
      maxOutputTokens: 20,
    })
      .then(({ text }) => this.store.renameConversation(conversationId, text.replace(/["\n]/g, "").trim().slice(0, 60) || conv.title))
      .catch(() => {});
  }
}

function isPlaceholder(output: unknown) {
  return !!output && typeof output === "object" && (output as any).status === "needs_approval";
}

function safeActivity(def: ToolDef, input: unknown) {
  try {
    return def.activity(input as any);
  } catch {
    return "Working";
  }
}

export type { Message };
