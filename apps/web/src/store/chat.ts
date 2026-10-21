import { create } from "zustand";
import type { Approval, Conversation, Message, ServerEvent, TurnStatus } from "@bits/protocol";
import { api, ApiError } from "../api";

export const HOME = "home";

export interface ConvState {
  messages: Message[]; // persisted, sorted by seq
  lastSeq: number;
  loaded: boolean;
  error?: string;
}

export interface PendingMessage {
  id: string;
  conversationId: string;
  text: string;
  source: "app" | "voice";
  createdAt: number;
  status: "sending" | "failed";
}

export interface TurnState {
  turnId: string | null;
  status: TurnStatus | "idle";
  activity?: string;
  at: number;
}

export type Connection = "connecting" | "online" | "offline";

interface ChatState {
  conversations: Conversation[];
  conversationsLoaded: boolean;
  activeId: string;
  view: "chat" | "memory";
  convs: Record<string, ConvState>;
  pending: Record<string, PendingMessage[]>;
  live: Record<string, { turnId: string; text: string } | undefined>;
  turns: Record<string, TurnState | undefined>;
  approvals: Record<string, Approval>;
  /** Ids from the last `GET /approvals?status=pending`; null until loaded. */
  pendingApprovalIds: string[] | null;
  connection: Connection;

  setActive: (id: string) => void;
  setView: (view: "chat" | "memory") => void;
  setConnection: (c: Connection) => void;
  loadConversations: () => Promise<void>;
  newConversation: () => Promise<void>;
  ensureLoaded: (id: string) => Promise<void>;
  fetchAfter: (id: string) => Promise<void>;
  send: (conversationId: string, text: string, opts?: { source?: "app" | "voice"; id?: string }) => Promise<void>;
  retry: (conversationId: string, id: string) => Promise<void>;
  discard: (conversationId: string, id: string) => void;
  cancel: (conversationId: string) => Promise<void>;
  decide: (approvalId: string, decision: "approve" | "deny" | "always") => Promise<void>;
  loadApprovals: () => Promise<void>;
  applyEvent: (ev: ServerEvent) => void;
}

const TERMINAL: (TurnStatus | "idle")[] = ["done", "failed", "cancelled", "idle"];
export const isTerminal = (s: TurnStatus | "idle" | undefined) => !s || TERMINAL.includes(s);

// Fetch coordination (outside React state on purpose).
const inflight = new Map<string, Promise<void>>();
const dirty = new Set<string>();

function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  if (!incoming.length) return existing;
  const byId = new Map<string, Message>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

function initialActive(): string {
  try {
    return new URLSearchParams(location.search).get("c") ?? localStorage.getItem("bits.active") ?? HOME;
  } catch {
    return HOME;
  }
}

export const useChat = create<ChatState>()((set, get) => {
  /** Merge a page of persisted messages into a conversation, reconciling optimistic + live state. */
  function absorb(id: string, incoming: Message[]) {
    set((s) => {
      const cur = s.convs[id] ?? { messages: [], lastSeq: 0, loaded: false };
      const messages = mergeMessages(cur.messages, incoming);
      const maxSeq = messages.length ? messages[messages.length - 1].seq : 0;
      const ids = new Set(incoming.map((m) => m.id));
      const pend = s.pending[id]?.filter((p) => !ids.has(p.id));
      let live = s.live[id];
      if (live && incoming.some((m) => m.role === "assistant" && (!m.turnId || m.turnId === live!.turnId))) {
        live = undefined;
      }
      return {
        convs: { ...s.convs, [id]: { ...cur, messages, lastSeq: Math.max(cur.lastSeq, maxSeq) } },
        pending: pend ? { ...s.pending, [id]: pend } : s.pending,
        live: { ...s.live, [id]: live },
      };
    });
  }

  async function runFetch(id: string) {
    const startedAt = Date.now();
    for (let i = 0; i < 25; i++) {
      const after = get().convs[id]?.lastSeq ?? 0;
      const page = await api.messages(id, after);
      absorb(id, page.messages);
      // Turn snapshot — only trust "no turn" if nothing newer arrived over SSE meanwhile.
      set((s) => {
        const prev = s.turns[id];
        let next: TurnState | undefined = prev;
        if (page.turn) {
          next = {
            turnId: page.turn.id,
            status: page.turn.status,
            activity: prev?.turnId === page.turn.id ? prev.activity : undefined,
            at: Math.max(prev?.at ?? 0, startedAt),
          };
        } else if (prev && !isTerminal(prev.status) && prev.at <= startedAt) {
          next = { turnId: prev.turnId, status: "idle", at: startedAt };
        }
        return {
          turns: { ...s.turns, [id]: next },
          convs: { ...s.convs, [id]: { ...s.convs[id], loaded: true, error: undefined } },
          live: next && isTerminal(next.status) ? { ...s.live, [id]: undefined } : s.live,
        };
      });
      const got = get().convs[id]?.lastSeq ?? 0;
      // Gap / truncated page: keep pulling until we've caught up to the server's lastSeq.
      if (got >= page.lastSeq || page.messages.length === 0) break;
    }
  }

  return {
    conversations: [],
    conversationsLoaded: false,
    activeId: initialActive(),
    view: "chat",
    convs: {},
    pending: {},
    live: {},
    turns: {},
    approvals: {},
    pendingApprovalIds: null,
    connection: "connecting",

    setActive(id) {
      try {
        localStorage.setItem("bits.active", id);
      } catch {
        /* ignore */
      }
      set({ activeId: id, view: "chat" });
      void get().ensureLoaded(id);
    },
    setView: (view) => set({ view }),
    setConnection: (connection) => set({ connection }),

    async loadConversations() {
      const list = await api.conversations();
      set((s) => {
        const turns = { ...s.turns };
        for (const c of list) {
          const prev = turns[c.id];
          if (!prev) turns[c.id] = { turnId: null, status: c.status, at: 0 };
        }
        return { conversations: list, conversationsLoaded: true, turns };
      });
    },

    async newConversation() {
      const c = await api.createConversation();
      set((s) => ({
        conversations: [c, ...s.conversations.filter((x) => x.id !== c.id)],
        convs: { ...s.convs, [c.id]: { messages: [], lastSeq: 0, loaded: true } },
      }));
      get().setActive(c.id);
    },

    async ensureLoaded(id) {
      if (get().convs[id]?.loaded) return;
      await get().fetchAfter(id);
    },

    fetchAfter(id) {
      const running = inflight.get(id);
      if (running) {
        dirty.add(id);
        return running;
      }
      const p = (async () => {
        try {
          do {
            dirty.delete(id);
            await runFetch(id);
          } while (dirty.has(id));
        } catch (err) {
          set((s) => ({
            convs: {
              ...s.convs,
              [id]: { ...(s.convs[id] ?? { messages: [], lastSeq: 0, loaded: false }), error: (err as Error).message },
            },
          }));
        } finally {
          inflight.delete(id);
        }
      })();
      inflight.set(id, p);
      return p;
    },

    async send(conversationId, text, opts = {}) {
      const id = opts.id ?? crypto.randomUUID();
      const source = opts.source ?? "app";
      const trimmed = text.trim();
      if (!trimmed) return;
      set((s) => {
        const list = (s.pending[conversationId] ?? []).filter((p) => p.id !== id);
        const pm: PendingMessage = { id, conversationId, text: trimmed, source, createdAt: Date.now(), status: "sending" };
        return { pending: { ...s.pending, [conversationId]: [...list, pm] } };
      });
      try {
        const res = await api.send(conversationId, { id, text: trimmed, source });
        absorb(conversationId, [res.message]);
        if (res.turnId) {
          set((s) => {
            const prev = s.turns[conversationId];
            if (prev?.turnId === res.turnId && !isTerminal(prev.status)) return {};
            return {
              turns: { ...s.turns, [conversationId]: { turnId: res.turnId, status: "queued", at: Date.now() } },
            };
          });
        }
        if (!get().convs[conversationId]?.loaded) void get().fetchAfter(conversationId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) return; // duplicate — already persisted
        set((s) => ({
          pending: {
            ...s.pending,
            [conversationId]: (s.pending[conversationId] ?? []).map((p) => (p.id === id ? { ...p, status: "failed" } : p)),
          },
        }));
      }
    },

    async retry(conversationId, id) {
      const p = get().pending[conversationId]?.find((x) => x.id === id);
      if (p) await get().send(conversationId, p.text, { id, source: p.source });
    },

    discard(conversationId, id) {
      set((s) => ({ pending: { ...s.pending, [conversationId]: (s.pending[conversationId] ?? []).filter((p) => p.id !== id) } }));
    },

    async cancel(conversationId) {
      await api.cancel(conversationId);
    },

    async decide(approvalId, decision) {
      const prev = get().approvals[approvalId];
      const optimistic = { ...(prev ?? ({ id: approvalId } as Approval)), status: decision === "deny" ? "denied" : "approved" } as Approval;
      set((s) => ({ approvals: { ...s.approvals, [approvalId]: optimistic } }));
      try {
        const res = await api.decide(approvalId, decision);
        set((s) => ({ approvals: { ...s.approvals, [approvalId]: res } }));
      } catch (err) {
        set((s) => {
          const approvals = { ...s.approvals };
          if (prev) approvals[approvalId] = prev;
          else delete approvals[approvalId];
          return { approvals };
        });
        throw err;
      }
    },

    async loadApprovals() {
      const list = await api.approvals("pending");
      set((s) => {
        const approvals = { ...s.approvals };
        for (const a of list) approvals[a.id] = a;
        return { approvals, pendingApprovalIds: list.map((a) => a.id) };
      });
    },

    applyEvent(ev) {
      switch (ev.type) {
        case "changed": {
          const c = get().convs[ev.conversationId];
          if (c?.loaded && ev.seq > c.lastSeq) void get().fetchAfter(ev.conversationId);
          set((s) => ({
            conversations: s.conversations.map((x) =>
              x.id === ev.conversationId ? { ...x, lastSeq: Math.max(x.lastSeq, ev.seq), updatedAt: Date.now() } : x,
            ),
          }));
          break;
        }
        case "conversations":
          void get().loadConversations().catch(() => {});
          break;
        case "turn": {
          set((s) => {
            const terminal = isTerminal(ev.status);
            const live = s.live[ev.conversationId];
            return {
              turns: {
                ...s.turns,
                [ev.conversationId]: { turnId: ev.turnId, status: ev.status, activity: ev.activity, at: Date.now() },
              },
              live: terminal && live ? { ...s.live, [ev.conversationId]: undefined } : s.live,
            };
          });
          // A terminal turn usually comes right after the final message: make sure we have it.
          if (isTerminal(ev.status) && get().convs[ev.conversationId]?.loaded) void get().fetchAfter(ev.conversationId);
          break;
        }
        case "delta": {
          set((s) => {
            const cur = s.live[ev.conversationId];
            const text = cur && cur.turnId === ev.turnId ? cur.text + ev.text : ev.text;
            const turn = s.turns[ev.conversationId];
            return {
              live: { ...s.live, [ev.conversationId]: { turnId: ev.turnId, text } },
              turns:
                turn?.turnId === ev.turnId && !isTerminal(turn.status)
                  ? s.turns
                  : { ...s.turns, [ev.conversationId]: { turnId: ev.turnId, status: "running", at: Date.now() } },
            };
          });
          break;
        }
        case "approval":
          set((s) => ({ approvals: { ...s.approvals, [ev.approval.id]: ev.approval } }));
          break;
        default:
          break;
      }
    },
  };
});

// ---------- Selectors / helpers ----------

export function activeConversation(s: ChatState): Conversation | undefined {
  return s.conversations.find((c) => c.id === s.activeId);
}
