import { randomUUID } from "node:crypto";
import type { Approval, Conversation, Message, Part, Role, Turn, TurnStatus } from "@bits/protocol";
import { bus } from "./bus.ts";
import { tx, type DB } from "./db.ts";

const TERMINAL: TurnStatus[] = ["done", "failed", "cancelled"];
export const isTerminal = (s: TurnStatus) => TERMINAL.includes(s);

type Row = Record<string, any>;

function rowToMessage(r: Row): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    seq: Number(r.seq),
    role: r.role,
    parts: JSON.parse(r.parts),
    turnId: r.turn_id,
    meta: r.meta ? JSON.parse(r.meta) : null,
    createdAt: Number(r.created_at),
  };
}

function rowToTurn(r: Row): Turn {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    status: r.status,
    trigger: r.trigger,
    steps: Number(r.steps),
    error: r.error,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function rowToApproval(r: Row): Approval {
  return {
    id: r.id,
    turnId: r.turn_id,
    conversationId: r.conversation_id,
    toolCallId: r.tool_call_id,
    toolName: r.tool_name,
    input: JSON.parse(r.input),
    reason: r.reason,
    status: r.status,
    createdAt: Number(r.created_at),
  };
}

export function textOf(parts: Part[]) {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n")
    .trim();
}

export class Store {
  readonly db: DB;
  constructor(db: DB) {
    this.db = db;
    this.ensureConversation("home", "Home");
  }

  // ---------- conversations ----------

  ensureConversation(id: string, title: string) {
    const now = Date.now();
    this.db
      .prepare("INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, title, now, now);
  }

  createConversation(title = "New conversation"): Conversation {
    const id = randomUUID();
    this.ensureConversation(id, title);
    bus.emit({ type: "conversations" });
    return this.getConversation(id)!;
  }

  getConversation(id: string): Conversation | null {
    const r = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    const turn = this.activeTurn(id);
    return {
      id: r.id,
      title: r.title,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      lastSeq: Number(r.last_seq),
      status: turn?.status ?? "idle",
    };
  }

  listConversations(): Conversation[] {
    const rows = this.db.prepare("SELECT id FROM conversations ORDER BY (id = 'home') DESC, updated_at DESC").all() as Row[];
    return rows.map((r) => this.getConversation(r.id)!).filter(Boolean);
  }

  renameConversation(id: string, title: string) {
    this.db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, id);
    bus.emit({ type: "conversations" });
  }

  getSummary(id: string): { summary: string | null; upto: number } {
    const r = this.db.prepare("SELECT summary, summary_upto FROM conversations WHERE id = ?").get(id) as Row;
    return { summary: r?.summary ?? null, upto: Number(r?.summary_upto ?? 0) };
  }

  setSummary(id: string, summary: string, upto: number) {
    this.db.prepare("UPDATE conversations SET summary = ?, summary_upto = ? WHERE id = ?").run(summary, upto, id);
  }

  // ---------- messages ----------

  /** Append a message with the next sequence number. Dropping duplicate ids makes client retries safe. */
  appendMessage(input: {
    id?: string;
    conversationId: string;
    role: Role;
    parts: Part[];
    turnId?: string | null;
    meta?: Message["meta"];
  }): { message: Message; duplicate: boolean } {
    const id = input.id ?? randomUUID();
    const result = tx(this.db, () => {
      const existing = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Row | undefined;
      if (existing) return { message: rowToMessage(existing), duplicate: true };
      const now = Date.now();
      const conv = this.db
        .prepare("UPDATE conversations SET last_seq = last_seq + 1, updated_at = ? WHERE id = ? RETURNING last_seq")
        .get(now, input.conversationId) as Row | undefined;
      if (!conv) throw new Error(`Unknown conversation ${input.conversationId}`);
      const seq = Number(conv.last_seq);
      this.db
        .prepare(
          "INSERT INTO messages (id, conversation_id, seq, role, parts, turn_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, input.conversationId, seq, input.role, JSON.stringify(input.parts), input.turnId ?? null, input.meta ? JSON.stringify(input.meta) : null, now);
      const text = textOf(input.parts);
      if (text && (input.role === "user" || input.role === "assistant")) {
        this.db
          .prepare("INSERT INTO search (source, ref, ts, body) VALUES ('chat', ?, ?, ?)")
          .run(`${input.conversationId}#${seq}`, now, `${input.role}: ${text}`);
      }
      return {
        message: rowToMessage(this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Row),
        duplicate: false,
      };
    });
    if (!result.duplicate) bus.emit({ type: "changed", conversationId: input.conversationId, seq: result.message.seq });
    return result;
  }

  getMessages(conversationId: string, after = 0, limit = 500): Message[] {
    return (
      this.db
        .prepare("SELECT * FROM messages WHERE conversation_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?")
        .all(conversationId, after, limit) as Row[]
    ).map(rowToMessage);
  }

  lastMessages(conversationId: string, n: number): Message[] {
    return (
      this.db
        .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT ?")
        .all(conversationId, n) as Row[]
    )
      .map(rowToMessage)
      .reverse();
  }

  // ---------- turns ----------

  createTurn(conversationId: string, trigger: Turn["trigger"], seenSeq: number): Turn {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO turns (id, conversation_id, status, trigger, seen_seq, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?, ?)",
      )
      .run(id, conversationId, trigger, seenSeq, now, now);
    const turn = this.getTurn(id)!;
    bus.emit({ type: "turn", conversationId, turnId: id, status: "queued" });
    return turn;
  }

  getTurn(id: string): Turn | null {
    const r = this.db.prepare("SELECT * FROM turns WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToTurn(r) : null;
  }

  turnSeenSeq(id: string): number {
    const r = this.db.prepare("SELECT seen_seq FROM turns WHERE id = ?").get(id) as Row;
    return Number(r.seen_seq);
  }

  setTurnSeen(id: string, seq: number) {
    this.db.prepare("UPDATE turns SET seen_seq = MAX(seen_seq, ?) WHERE id = ?").run(seq, id);
  }

  private activities = new Map<string, string>();

  updateTurn(id: string, patch: { status?: TurnStatus; steps?: number; error?: string | null; leaseUntil?: number | null }, activity?: string) {
    const cur = this.getTurn(id);
    if (!cur) return;
    if (activity) this.activities.set(id, activity);
    if (patch.status && isTerminal(patch.status)) this.activities.delete(id);
    this.db
      .prepare("UPDATE turns SET status = ?, steps = ?, error = ?, lease_until = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.status ?? cur.status,
        patch.steps ?? cur.steps,
        patch.error === undefined ? (cur.error ?? null) : patch.error,
        patch.leaseUntil === undefined ? null : patch.leaseUntil,
        Date.now(),
        id,
      );
    bus.emit({ type: "turn", conversationId: cur.conversationId, turnId: id, status: patch.status ?? cur.status, activity });
    if (patch.status) bus.emit({ type: "conversations" });
  }

  /** The latest unfinished turn for a conversation (queued, running, or waiting on a human). */
  activeTurn(conversationId: string): Turn | null {
    const r = this.db
      .prepare(
        "SELECT * FROM turns WHERE conversation_id = ? AND status IN ('queued','running','waiting') ORDER BY created_at DESC LIMIT 1",
      )
      .get(conversationId) as Row | undefined;
    if (!r) return null;
    const turn = rowToTurn(r);
    const activity = this.activities.get(turn.id);
    return activity ? { ...turn, activity } : turn;
  }

  /** Turns that need a worker: queued, or "running" with an expired lease (the daemon crashed mid-turn). */
  claimableTurns(now = Date.now()): Turn[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM turns WHERE status = 'queued' OR (status = 'running' AND (lease_until IS NULL OR lease_until < ?)) ORDER BY created_at ASC",
        )
        .all(now) as Row[]
    ).map(rowToTurn);
  }

  lastTurnEndedAt(conversationId: string): number | null {
    const r = this.db
      .prepare("SELECT MAX(updated_at) AS t FROM turns WHERE conversation_id = ? AND status IN ('done','failed','cancelled')")
      .get(conversationId) as Row;
    return r?.t ? Number(r.t) : null;
  }

  // ---------- durable tool runs ----------

  getToolRun(toolCallId: string): { output: unknown; isError: boolean } | null {
    const r = this.db.prepare("SELECT * FROM tool_runs WHERE tool_call_id = ? AND finished_at IS NOT NULL").get(toolCallId) as Row | undefined;
    return r ? { output: JSON.parse(r.output), isError: !!r.is_error } : null;
  }

  saveToolRun(toolCallId: string, turnId: string, toolName: string, output: unknown, isError: boolean) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO tool_runs (tool_call_id, turn_id, tool_name, output, is_error, finished_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(toolCallId, turnId, toolName, JSON.stringify(output ?? null), isError ? 1 : 0, Date.now());
  }

  // ---------- approvals ----------

  createApproval(a: Omit<Approval, "id" | "status" | "createdAt">): Approval {
    const existing = this.db.prepare("SELECT * FROM approvals WHERE tool_call_id = ?").get(a.toolCallId) as Row | undefined;
    if (existing) return rowToApproval(existing);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO approvals (id, turn_id, conversation_id, tool_call_id, tool_name, input, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(id, a.turnId, a.conversationId, a.toolCallId, a.toolName, JSON.stringify(a.input), a.reason, Date.now());
    const approval = this.getApproval(id)!;
    bus.emit({ type: "approval", approval });
    return approval;
  }

  getApproval(id: string): Approval | null {
    const r = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToApproval(r) : null;
  }

  approvalForCall(toolCallId: string): Approval | null {
    const r = this.db.prepare("SELECT * FROM approvals WHERE tool_call_id = ?").get(toolCallId) as Row | undefined;
    return r ? rowToApproval(r) : null;
  }

  listApprovals(status?: Approval["status"]): Approval[] {
    const rows = status
      ? this.db.prepare("SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC").all(status)
      : this.db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 200").all();
    return (rows as Row[]).map(rowToApproval);
  }

  decideApproval(id: string, status: "approved" | "denied"): Approval | null {
    this.db.prepare("UPDATE approvals SET status = ? WHERE id = ? AND status = 'pending'").run(status, id);
    const approval = this.getApproval(id);
    if (approval) bus.emit({ type: "approval", approval });
    return approval;
  }

  // ---------- kv ----------

  kvGet(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as Row | undefined;
    return r?.value ?? null;
  }

  kvSet(key: string, value: string) {
    this.db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(key, value);
  }
}
