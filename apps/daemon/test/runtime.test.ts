import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";

// Isolated home for every test run; config reads env at import time.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "bits-test-"));
process.env.BITS_HOME = home;
process.env.BITS_MODEL = "mock:main";
process.env.BITS_FAST_MODEL = "mock:fast";

const { setModelResolver } = await import("../src/models.ts");
const { openDb } = await import("../src/db.ts");
const memory = await import("../src/memory.ts");
const { Store } = await import("../src/store.ts");
const { Runtime } = await import("../src/agent/runtime.ts");
const { Artifacts, applyOps } = await import("../src/artifacts.ts");
const { toModelMessages } = await import("../src/agent/context.ts");

type Step = { text?: string; calls?: { name: string; input: unknown }[] };
let script: Step[] = [];
let reviewVerdict = '{"verdict":"ask","reason":"Running shell commands needs your OK."}';
let callNo = 0;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function streamFor(step: Step) {
  const parts: any[] = [{ type: "stream-start", warnings: [] }];
  if (step.text) {
    parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
  }
  for (const c of step.calls ?? []) {
    parts.push({ type: "tool-call", toolCallId: `call_${++callNo}`, toolName: c.name, input: JSON.stringify(c.input) });
  }
  parts.push({ type: "finish", finishReason: { unified: step.calls?.length ? "tool-calls" : "stop", raw: undefined }, usage });
  return { stream: convertArrayToReadableStream(parts) };
}

const main = new MockLanguageModelV4({
  doStream: async () => {
    const step = script.shift();
    if (!step) throw new Error("script exhausted");
    return streamFor(step) as any;
  },
});
const fast = new MockLanguageModelV4({
  doGenerate: async () =>
    ({
      content: [{ type: "text", text: reviewVerdict }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }) as any,
});
setModelResolver((id) => (id === "mock:fast" ? fast : main));

memory.initHome();
const db = openDb(path.join(home, "state.db"));
const store = new Store(db);
const artifacts = new Artifacts();
const runtime = new Runtime(store, artifacts);

async function until(pred: () => boolean, ms = 4000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

before(() => runtime.start());
after(() => {
  runtime.stop();
  db.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("a turn runs model → tools → model, saving every step", async () => {
  script = [
    {
      calls: [
        { name: "memory_remember", input: { fact: "Likes oat milk flat whites" } },
        { name: "present", input: { program: 'root = Card("Noted", [t])\nt = Text("Oat milk from now on")' } },
      ],
    },
    { text: "Got it — oat milk from now on." },
  ];
  const conv = store.createConversation("t1");
  const res = runtime.sendMessage(conv.id, { id: "m1", text: "I always take oat milk" });
  assert.equal(res.steering, false);
  await until(() => store.getTurn(res.turnId!)?.status === "done");

  const msgs = store.getMessages(conv.id);
  assert.deepEqual(
    msgs.map((m) => m.role),
    ["user", "assistant", "tool", "assistant"],
  );
  const results = msgs[2].parts.filter((p) => p.type === "tool-result") as any[];
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => !r.isError), JSON.stringify(results));
  assert.match(memory.readLog(new Date().toISOString().slice(0, 7)), /oat milk/);
  assert.ok(memory.search(db, "oat milk").length > 0);

  // Retrying the same client message id is a no-op.
  const dup = runtime.sendMessage(conv.id, { id: "m1", text: "I always take oat milk" });
  assert.equal(dup.duplicate, true);
  assert.equal(store.getMessages(conv.id).length, 4);
});

test("invalid generative UI goes back to the model as an error", async () => {
  script = [{ calls: [{ name: "present", input: { program: 'root = Pie("nope")' } }] }, { text: "Sorry, fixed." }];
  const conv = store.createConversation("t2");
  const { turnId } = runtime.sendMessage(conv.id, { id: "m2", text: "chart please" });
  await until(() => store.getTurn(turnId!)?.status === "done");
  const tool = store.getMessages(conv.id).find((m) => m.role === "tool")!;
  const r = tool.parts[0] as any;
  assert.equal(r.isError, true);
  assert.match(String(r.output), /unknown-component/);
});

test("risky actions wait for approval, then resume and run once", async () => {
  script = [{ calls: [{ name: "run_command", input: { command: "echo hello-from-bits" } }] }, { text: "Done." }];
  const conv = store.createConversation("t3");
  const { turnId } = runtime.sendMessage(conv.id, { id: "m3", text: "run echo for me" });
  await until(() => store.getTurn(turnId!)?.status === "waiting");
  const [approval] = store.listApprovals("pending").filter((a) => a.turnId === turnId);
  assert.ok(approval);
  assert.equal(approval.toolName, "run_command");

  runtime.decideApproval(approval.id, "approve");
  await until(() => store.getTurn(turnId!)?.status === "done");
  const results = store
    .getMessages(conv.id)
    .flatMap((m) => m.parts)
    .filter((p): p is any => p.type === "tool-result");
  assert.equal(results[0].output.status, "needs_approval");
  assert.match(results[1].output.stdout, /hello-from-bits/);
  // The model saw the real result, not the placeholder.
  const modelMsgs = toModelMessages(store, conv.id);
  const toolMsgs = modelMsgs.filter((m) => m.role === "tool");
  assert.equal(toolMsgs.length, 1);
});

test("auto-review lets clearly requested external actions run without asking", async () => {
  reviewVerdict = '{"verdict":"allow","reason":"User asked for it."}';
  script = [{ calls: [{ name: "run_command", input: { command: "echo auto-ok" } }] }, { text: "Ran it." }];
  const conv = store.createConversation("t4");
  const { turnId } = runtime.sendMessage(conv.id, { id: "m4", text: "please run echo auto-ok" });
  await until(() => store.getTurn(turnId!)?.status === "done");
  assert.equal(store.listApprovals().filter((a) => a.turnId === turnId).length, 0);
});

test("a crashed turn resumes from its last saved step without redoing tools", async () => {
  const conv = store.createConversation("t5");
  const user = store.appendMessage({ conversationId: conv.id, role: "user", parts: [{ type: "text", text: "remember I live in Toronto" }] });
  const turn = store.createTurn(conv.id, "message", user.message.seq - 1);
  // Simulate: the model step was saved, then the process died before tools ran.
  store.appendMessage({
    conversationId: conv.id,
    role: "assistant",
    turnId: turn.id,
    parts: [{ type: "tool-call", toolCallId: "crash_1", toolName: "memory_remember", input: { fact: "Lives in Toronto" } }],
  });
  store.updateTurn(turn.id, { status: "running", leaseUntil: Date.now() - 1, steps: 1 });
  script = [{ text: "Saved: Toronto." }];
  await until(() => store.getTurn(turn.id)?.status === "done");
  const roles = store.getMessages(conv.id).map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "tool", "assistant"]);
  assert.equal(memory.search(db, "Toronto").length >= 1, true);
});

test("steering messages are moved after pending tool results for the model", () => {
  const conv = store.createConversation("t6");
  store.appendMessage({ conversationId: conv.id, role: "user", parts: [{ type: "text", text: "find flights" }] });
  store.appendMessage({
    conversationId: conv.id,
    role: "assistant",
    parts: [{ type: "tool-call", toolCallId: "s1", toolName: "web_search", input: { query: "flights" } }],
  });
  store.appendMessage({ conversationId: conv.id, role: "user", parts: [{ type: "text", text: "actually make it Thursday" }] });
  store.appendMessage({ conversationId: conv.id, role: "tool", parts: [{ type: "tool-result", toolCallId: "s1", toolName: "web_search", output: [] }] });
  const roles = toModelMessages(store, conv.id).map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "tool", "user"]);
});

test("unfinished tool calls get an 'interrupted' result so history stays valid", () => {
  const conv = store.createConversation("t7");
  store.appendMessage({ conversationId: conv.id, role: "user", parts: [{ type: "text", text: "go" }] });
  store.appendMessage({
    conversationId: conv.id,
    role: "assistant",
    parts: [{ type: "tool-call", toolCallId: "x1", toolName: "web_search", input: { query: "x" } }],
  });
  store.appendMessage({ conversationId: conv.id, role: "user", parts: [{ type: "text", text: "never mind" }] });
  const msgs = toModelMessages(store, conv.id);
  assert.deepEqual(
    msgs.map((m) => m.role),
    ["user", "assistant", "tool", "user"],
  );
});

test("data ops: push with ids, toggle and remove by selector", () => {
  let d: any = applyOps({}, [{ op: "push", path: "items", value: { text: "$input.text", done: false } }], { text: "Milk" });
  assert.equal(d.items.length, 1);
  const id = d.items[0].id;
  assert.ok(id);
  d = applyOps(d, [{ op: "toggle", path: "items[id=$input.id].done" }], { id });
  assert.equal(d.items[0].done, true);
  d = applyOps(d, [{ op: "increment", path: "stats.count", by: 2 }]);
  assert.equal(d.stats.count, 2);
  d = applyOps(d, [{ op: "remove", path: "items[id=$input.id]" }], { id });
  assert.equal(d.items.length, 0);
  assert.throws(() => applyOps(d, [{ op: "toggle", path: "items[id=zzz].done" }]), /Nothing matches/);
});

const habitProgram = `root = Card("Habits", [list, draft, add])
list = List($data.habits)
draft = TextInput("New habit", value: $ui.draft, change: @Set($ui.draft, $event))
add = Button("Add", press: @Tool("add_habit", {name: $ui.draft}))`;

test("artifacts: Bits creates one, a person runs an action, notify wakes Bits", async () => {
  script = [
    {
      calls: [
        {
          name: "artifact_create",
          input: {
            title: "Habits",
            kind: "tracker",
            description: "Daily habits",
            program: habitProgram,
            data: { habits: [] },
            actions: {
              add_habit: {
                description: "Add a habit",
                input: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
                ops: [{ op: "push", path: "habits", value: { title: "$input.name", streak: 0 } }],
                notify: true,
              },
            },
          },
        },
      ],
    },
    { text: "Made you a habit tracker." },
  ];
  const conv = store.createConversation("t8");
  const { turnId } = runtime.sendMessage(conv.id, { id: "m8", text: "make me a habit tracker" });
  await until(() => store.getTurn(turnId!)?.status === "done");
  const created = store.getMessages(conv.id).flatMap((m) => m.parts).find((p: any) => p.type === "tool-result") as any;
  assert.ok(!created.isError, JSON.stringify(created.output));
  const id = created.output.id;
  assert.deepEqual(artifacts.get(id).data, { habits: [] });

  await assert.rejects(artifacts.runAction(id, "add_habit", {}, "person"), /Invalid input/);
  await assert.rejects(artifacts.runAction(id, "nope", {}, "person"), /no action/);

  script = [{ text: "Nice — added Stretch." }];
  await artifacts.runAction(id, "add_habit", { name: "Stretch" }, "person");
  assert.equal((artifacts.get(id).data as any).habits[0].title, "Stretch");
  assert.equal(artifacts.activity(id)[0].by, "person");
  await until(() => store.getMessages(conv.id).some((m) => m.meta?.source === "artifact"));
  await until(() => store.activeTurn(conv.id) === null);
  const last = store.getMessages(conv.id).at(-1)!;
  assert.equal(last.role, "assistant");
});

test("artifacts: a view calling an undeclared action is rejected", () => {
  assert.throws(
    () =>
      artifacts.create({
        title: "Bad",
        kind: "list",
        description: "",
        program: habitProgram,
        data: {},
        actions: { other: { description: "x", ops: [{ op: "set", path: "a", value: 1 }] } },
        conversationId: "home",
      }),
    /unknown-action/,
  );
});
