// An in-memory stand-in for the daemon, used when the app is built with VITE_BITS_DEMO=1.
// It answers the same calls as `api` and pushes the same live events, so every store and view
// runs unchanged. Replies are scripted from the fixture samples; nothing leaves the browser.
import type { Approval, ArtifactActivity, Message, Part, ServerEvent, Turn, TurnStatus, UINode } from "@bits/protocol";
import type { Api, FullArtifact } from "../api";
import { applyOps } from "../fixtures/dataOps";
import { NODES } from "../fixtures/samples";
import { DEMO_SKILL, READING_LIST, TRIP, demoApprovals, demoArtifacts, demoConversations, demoLog, demoMemory, present } from "./data";

// ---------- live events ----------

const listeners = new Set<(ev: ServerEvent) => void>();
export function onDemoEvent(fn: (ev: ServerEvent) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const emit = (ev: ServerEvent) => queueMicrotask(() => listeners.forEach((fn) => fn(ev)));

// ---------- state ----------

const seeded = demoConversations();
const conversations = seeded.conversations;
const messages = seeded.messages;
const turns: Record<string, Turn | undefined> = {
  grinders: turn("grinders", "grinders-t1", "waiting"),
};
const approvals = new Map(demoApprovals().map((a) => [a.id, a]));
const artifacts = new Map(demoArtifacts().map((a) => [a.id, a]));
const activity: Record<string, ArtifactActivity[]> = {};
const memory = demoMemory();
const cancelled = new Set<string>();

function turn(conversationId: string, id: string, status: TurnStatus, activity?: string): Turn {
  const now = Date.now();
  return { id, conversationId, status, trigger: "message", steps: 1, activity, createdAt: now, updatedAt: now };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const later = <T>(value: T, ms = 90) => sleep(ms).then(() => structuredClone(value));
const node = (name: string) => NODES.find((n) => n.name === name)!.node;
let counter = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}${(counter++).toString(36)}`;

function conv(id: string) {
  const c = conversations.find((x) => x.id === id);
  if (!c) throw new Error("No such conversation");
  return c;
}

function append(conversationId: string, role: Message["role"], parts: Part[], extra: Partial<Message> = {}) {
  const list = (messages[conversationId] ??= []);
  const c = conv(conversationId);
  const msg: Message = {
    id: nextId("m"),
    conversationId,
    seq: c.lastSeq + 1,
    role,
    parts,
    turnId: null,
    createdAt: Date.now(),
    ...extra,
  };
  list.push(msg);
  c.lastSeq = msg.seq;
  c.updatedAt = msg.createdAt;
  emit({ type: "changed", conversationId, seq: msg.seq });
  return msg;
}

function setTurn(conversationId: string, turnId: string, status: TurnStatus, activity?: string) {
  turns[conversationId] = turn(conversationId, turnId, status, activity);
  conv(conversationId).status = status;
  emit({ type: "turn", conversationId, turnId, status, activity });
}

// ---------- scripted replies ----------

interface Reply {
  tools?: { name: string; input: unknown; output: unknown; label: string }[];
  text: string;
  parts?: Part[];
}

const SUGGESTIONS: UINode = {
  type: "actions",
  buttons: [
    { label: "Compare espresso grinders", message: "Compare espresso grinders under $300", style: "secondary" },
    { label: "Plan my day", message: "Plan my day", style: "secondary" },
    { label: "Show my reading list", message: "Show my reading list", style: "secondary" },
    { label: "Plan my Lisbon trip", message: "Show my Lisbon trip", style: "secondary" },
  ],
};

const ui = (id: string, input: unknown): Part => ({ type: "tool-call", toolCallId: id, toolName: "render_ui", input });
const presentPart = (id: string, name: string): Part => ({ type: "tool-call", toolCallId: id, toolName: "present", input: present(name) });
const artifactPart = (id: string, title: string): Part => ({
  type: "tool-call",
  toolCallId: id,
  toolName: "artifact_create",
  input: { title, kind: "list" },
});

function replyFor(text: string): Reply {
  const t = text.toLowerCase();
  if (/grinder|coffee|espresso/.test(t))
    return {
      tools: [
        { name: "memory_search", input: { query: "coffee preferences" }, output: { matches: 1 }, label: "Checking what I know" },
        { name: "web_search", input: { query: "best espresso grinder under $300" }, output: { results: 8 }, label: "Searching the web" },
      ],
      text: "You drink flat whites, so I weighted espresso performance. The **DF54** is the best value under $300.",
      parts: [ui(nextId("c"), { title: "Espresso grinders under $300", ui: node("table") })],
    };
  if (/read|book/.test(t))
    return {
      text: "Here’s your reading list. Tap a row to mark it read, or add a new book at the bottom.",
      parts: [artifactPart(nextId("c"), "Reading list")],
    };
  if (/trip|travel|lisbon|flight|pack/.test(t))
    return {
      tools: [{ name: "memory_search", input: { query: "Lisbon trip" }, output: { matches: 3 }, label: "Checking what I know" }],
      text: "Flights are booked and the hotel is confirmed. You’re 60% packed.",
      parts: [artifactPart(nextId("c"), "Lisbon trip")],
    };
  if (/day|week|plan|calendar|schedule|today/.test(t))
    return {
      tools: [{ name: "read_file", input: { path: "calendar/today.ics" }, output: "BEGIN:VCALENDAR…", label: "Reading your calendar" }],
      text: "Here’s the plan. Lunch with Sam is at 1, so I left the morning clear for deep work.",
      parts: [ui(nextId("c"), { ui: node("timeline") })],
    };
  if (/dinner|recipe|cook|food/.test(t))
    return { text: "Tell me a little more and I’ll find recipes.", parts: [presentPart(nextId("c"), "form with $ui + @Say")] };
  if (/revenue|stats|numbers|month|august/.test(t))
    return { text: "August is on track.", parts: [presentPart(nextId("c"), "stats + callout")] };
  if (/notion|apple notes|bits memory/.test(t))
    return { text: `Done. I’ll keep grinder notes in **${text.trim()}** and check prices every Monday at 9.` };
  if (/^(hi|hey|hello|yo)\b/.test(t))
    return { text: "Hi! This is a demo running on sample data, so I can’t reach the web or your apps here. Try one of these:", parts: [ui(nextId("c"), { ui: SUGGESTIONS })] };
  return {
    text: "In this demo I run on sample data, so I can’t look that up for real. Install Bits to run it on your own machine. Meanwhile, try one of these:",
    parts: [ui(nextId("c"), { ui: SUGGESTIONS })],
  };
}

async function runTurn(conversationId: string, turnId: string, text: string) {
  const reply = replyFor(text);
  const stopped = () => cancelled.has(turnId);
  setTurn(conversationId, turnId, "running", "Thinking");
  await sleep(500);

  for (const tool of reply.tools ?? []) {
    if (stopped()) return;
    setTurn(conversationId, turnId, "running", tool.label);
    const callId = nextId("call");
    append(conversationId, "assistant", [{ type: "tool-call", toolCallId: callId, toolName: tool.name, input: tool.input }], { turnId });
    await sleep(650);
    append(conversationId, "tool", [{ type: "tool-result", toolCallId: callId, toolName: tool.name, output: tool.output }], { turnId });
  }

  // Stream the text, word by word, the way the daemon sends deltas.
  setTurn(conversationId, turnId, "running", "Writing");
  // A few words per delta keeps re-renders cheap while still reading as a stream.
  const words = reply.text.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < words.length; i += 4) {
    if (stopped()) return;
    emit({ type: "delta", conversationId, turnId, text: words.slice(i, i + 4).join("") });
    await sleep(45);
  }
  if (stopped()) return;
  const parts: Part[] = [{ type: "text", text: reply.text }, ...(reply.parts ?? [])];
  append(conversationId, "assistant", parts, { turnId });
  // Artifact cards need their tool result to know which artifact to show.
  const created = (reply.parts ?? []).filter((p): p is Extract<Part, { type: "tool-call" }> => p.type === "tool-call" && p.toolName === "artifact_create");
  if (created.length) {
    append(
      conversationId,
      "tool",
      created.map((p) => {
        const id = (p.input as { title: string }).title === "Lisbon trip" ? TRIP : READING_LIST;
        return { type: "tool-result" as const, toolCallId: p.toolCallId, toolName: p.toolName, output: { id, title: (p.input as { title: string }).title } };
      }),
      { turnId },
    );
  }
  setTurn(conversationId, turnId, "done");
}

// ---------- the api ----------

export const demoApi: Api = {
  health: () => later({ ok: true as const, version: "demo", model: "demo" }),

  conversations: () => later([...conversations].sort((a, b) => (a.id === "home" ? -1 : b.id === "home" ? 1 : b.updatedAt - a.updatedAt))),
  async createConversation(title) {
    const now = Date.now();
    const c = { id: nextId("conv"), title: title ?? "New conversation", createdAt: now, updatedAt: now, lastSeq: 0, status: "idle" as const };
    conversations.push(c);
    messages[c.id] = [];
    emit({ type: "conversations" });
    return later(c, 60);
  },
  messages(id, after = 0) {
    const c = conv(id);
    const t = turns[id];
    return later({
      messages: (messages[id] ?? []).filter((x) => x.seq > after),
      lastSeq: c.lastSeq,
      turn: t && !["done", "failed", "cancelled"].includes(t.status) ? t : null,
    });
  },
  async send(conversationId, body) {
    const c = conv(conversationId);
    const dup = (messages[conversationId] ?? []).find((x) => x.id === body.id);
    if (dup) return later({ message: dup, duplicate: true, turnId: null, steering: false });
    const message = append(conversationId, "user", [{ type: "text", text: body.text }], {
      id: body.id,
      meta: body.source === "voice" ? { source: "voice" } : null,
    });
    if (c.title === "New conversation") {
      c.title = body.text.length > 32 ? `${body.text.slice(0, 32).trimEnd()}…` : body.text;
      emit({ type: "conversations" });
    }
    const prev = turns[conversationId];
    if (prev && prev.status === "waiting") setTurn(conversationId, prev.id, "done");
    const turnId = nextId("turn");
    setTurn(conversationId, turnId, "queued");
    void runTurn(conversationId, turnId, body.text);
    return later({ message, duplicate: false, turnId, steering: false }, 60);
  },
  async cancel(conversationId) {
    const t = turns[conversationId];
    if (t && !["done", "failed", "cancelled"].includes(t.status)) {
      cancelled.add(t.id);
      setTurn(conversationId, t.id, "cancelled");
    }
    return later({ ok: true });
  },

  approvals: (status = "pending") => later([...approvals.values()].filter((a) => a.status === status)),
  async decide(id, decision) {
    const a = approvals.get(id);
    if (!a) throw new Error("No such approval");
    const next: Approval = { ...a, status: decision === "deny" ? "denied" : "approved" };
    approvals.set(id, next);
    emit({ type: "approval", approval: next });
    return later(next);
  },

  memory: () => later(memory),
  async saveProfile(content) {
    memory.profile = content;
    emit({ type: "memory" });
    return later({ ok: true as const });
  },
  log: (month) => later({ content: demoLog(month) }),
  skill: (name) => later({ name, description: memory.skills.find((s) => s.name === name)?.description ?? "", content: DEMO_SKILL }),
  async runRoutine(name) {
    const turnId = nextId("turn");
    append("home", "event", [{ type: "text", text: "Morning brief routine ran" }], { meta: { source: "routine", routine: name } });
    void runTurn("home", turnId, "plan my day");
    return later({ turnId });
  },
  async setRoutine(name, enabled) {
    memory.routines = memory.routines.map((r) => (r.name === name ? { ...r, enabled } : r));
    return later({ ok: true as const });
  },

  artifacts: () => later([...artifacts.values()].map(({ program: _p, data: _d, ...meta }) => meta)),
  async artifact(id) {
    const a = artifacts.get(id);
    if (!a) throw new Error("No such artifact");
    return later(a as FullArtifact);
  },
  artifactActivity: (id) => later(activity[id] ?? []),
  async runAction(id, action, input, by) {
    const a = artifacts.get(id);
    if (!a) throw new Error("No such artifact");
    const def = a.actions[action];
    if (!def) throw new Error(`No action "${action}"`);
    const required = ((def.input as { required?: string[] } | undefined)?.required ?? []) as string[];
    for (const key of required) {
      const v = (input as Record<string, unknown> | null)?.[key];
      if (v === undefined || v === null || v === "") throw new Error(`Invalid input: ${key} is required`);
    }
    a.data = applyOps(a.data, def.ops as never, input ?? {});
    a.dataVersion++;
    a.updatedAt = Date.now();
    (activity[id] ??= []).unshift({ at: Date.now(), action, input, by });
    emit({ type: "artifact", id, version: a.version, dataVersion: a.dataVersion });
    return later({ data: a.data, dataVersion: a.dataVersion });
  },

  voiceConfig: () => later({ stt: "browser" as const, tts: "browser" as const }),
  transcribe: () => Promise.reject(new Error("In the demo, voice runs in your browser.")),
  speak: () => Promise.reject(new Error("In the demo, voice runs in your browser.")),
};
