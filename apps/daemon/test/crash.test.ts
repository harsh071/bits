import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";

// Crash boundaries. A "crash" here is a Runtime that stops making progress without cleaning up
// (its worker hangs forever), followed by a fresh Runtime on the same database — what a restart sees.

const home = fs.mkdtempSync(path.join(os.tmpdir(), "bits-crash-"));
process.env.BITS_HOME = home;
process.env.BITS_MODEL = "mock:main";
process.env.BITS_FAST_MODEL = "mock:fast";

const { setModelResolver } = await import("../src/models.ts");
const { openDb } = await import("../src/db.ts");
const memory = await import("../src/memory.ts");
const { Store } = await import("../src/store.ts");
const { Runtime } = await import("../src/agent/runtime.ts");
const { Artifacts } = await import("../src/artifacts.ts");
const { loadPolicy, alwaysAllow, review } = await import("../src/agent/sentinel.ts");

type Step = { text?: string; calls?: { name: string; input: unknown }[] };
let script: Step[] = [];
let callNo = 0;
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
setModelResolver((id) =>
  id === "mock:fast"
    ? new MockLanguageModelV4({
        doGenerate: async () =>
          ({ content: [{ type: "text", text: '{"verdict":"ask","reason":"Sends an email."}' }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }) as any,
      })
    : new MockLanguageModelV4({
        doStream: async () => {
          const step = script.shift() ?? { text: "ok" };
          const parts: any[] = [{ type: "stream-start", warnings: [] }];
          if (step.text) parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
          for (const c of step.calls ?? []) parts.push({ type: "tool-call", toolCallId: `call_${++callNo}`, toolName: c.name, input: JSON.stringify(c.input) });
          parts.push({ type: "finish", finishReason: { unified: step.calls?.length ? "tool-calls" : "stop", raw: undefined }, usage });
          return { stream: convertArrayToReadableStream(parts) } as any;
        },
      }),
);

memory.initHome();
const db = openDb(path.join(home, "state.db"));
const store = new Store(db);

// A side effect we can count: "sending an email".
let sends = 0;
let hangNextSend = false;
const sendEmail = {
  name: "send_email",
  description: "Send an email",
  input: z.object({ to: z.string() }),
  risk: "external" as const,
  activity: () => "Sending",
  async execute() {
    sends++;
    if (hangNextSend) {
      hangNextSend = false;
      await new Promise(() => {}); // the process dies here: the email went out, nothing was recorded
    }
    return { sent: true };
  },
};

const live: InstanceType<typeof Runtime>[] = [];

/** Start "the daemon". Like a real restart, any earlier one is gone first: there is only ever one. */
function boot(tools: any[] = [sendEmail]) {
  for (const old of live.splice(0)) old.stop();
  const r = new Runtime(store, new Artifacts());
  r.extraTools = () => tools;
  r.start();
  live.push(r);
  return r;
}

async function until(pred: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}

after(() => {
  for (const r of live) r.stop();
  db.close();
  fs.rmSync(home, { recursive: true, force: true });
});

async function waitingTurn() {
  script = [{ calls: [{ name: "send_email", input: { to: "pat@example.com" } }] }, { text: "Sent." }];
  const conv = store.createConversation("crash");
  const r = boot();
  const { turnId } = r.sendMessage(conv.id, { id: `m-${conv.id}`, text: "email pat" });
  assert.ok(await until(() => store.getTurn(turnId!)?.status === "waiting"));
  const [approval] = store.listApprovals("pending").filter((a) => a.turnId === turnId);
  return { r, turnId: turnId!, approval };
}

test("approving re-queues the turn in the same transaction", async () => {
  const { r, turnId, approval } = await waitingTurn();
  r.stop(); // no worker: only the decision itself may move the turn
  store.decideApproval(approval.id, "approved");
  assert.equal(store.getTurn(turnId)?.status, "queued");
});

test("restart repairs a turn left waiting with its approval already decided", async () => {
  const { r, turnId, approval } = await waitingTurn();
  r.stop();
  // What an older daemon could leave behind: the decision saved, the process gone before the requeue.
  db.prepare("UPDATE approvals SET status = 'approved' WHERE id = ?").run(approval.id);
  boot();
  const resumed = await until(() => store.getTurn(turnId)?.status === "done", 2500);
  assert.ok(resumed, `turn stuck in "${store.getTurn(turnId)?.status}" with its approval already approved`);
});

test("crash mid-execute after approval: does the side effect run once?", async () => {
  sends = 0;
  const { r, turnId, approval } = await waitingTurn();
  hangNextSend = true;
  r.decideApproval(approval.id, "approve");
  assert.ok(await until(() => sends === 1));
  r.stop(); // the hung worker never records a result, like a killed process
  boot();
  await until(() => store.getTurn(turnId)?.status === "done", 2500);
  assert.equal(sends, 1, `the approved email was sent ${sends} times`);
  const result = store
    .getMessages(store.getTurn(turnId)!.conversationId)
    .flatMap((m) => m.parts)
    .find((p: any) => p.type === "tool-result" && p.toolName === "send_email" && p.output?.status !== "needs_approval") as any;
  assert.equal(result.isError, true);
  assert.match(String(result.output), /may or may not have happened/);
});

test("an interrupted read runs again", async () => {
  let reads = 0;
  const lookup = {
    name: "lookup",
    description: "Look something up",
    input: z.object({}),
    risk: "read" as const,
    activity: () => "Looking",
    async execute() {
      if (++reads === 1) await new Promise(() => {}); // dies mid-read
      return { found: true };
    },
  };
  const withLookup = () => boot([sendEmail, lookup]);
  script = [{ calls: [{ name: "lookup", input: {} }] }, { text: "Found it." }];
  const conv = store.createConversation("read");
  const first = withLookup();
  const { turnId } = first.sendMessage(conv.id, { id: "m-read", text: "look it up" });
  assert.ok(await until(() => reads === 1));
  first.stop();
  withLookup();
  assert.ok(await until(() => store.getTurn(turnId!)?.status === "done"), `turn is ${store.getTurn(turnId!)?.status}`);
  assert.equal(reads, 2, "the read was replayed");
});

test("an unreadable policy fails closed, and Always allow won't overwrite it", async () => {
  const file = path.join(home, "policy.json");
  fs.writeFileSync(file, JSON.stringify({ allow: [], ask: [], deny: ["mcp__bank__*"] }));
  alwaysAllow("send_email");
  assert.deepEqual(loadPolicy(), { allow: ["send_email"], ask: [], deny: ["mcp__bank__*"] });
  assert.deepEqual(fs.readdirSync(home).filter((f) => f.includes(".tmp")), [], "no temp file left behind");

  const torn = '{"allow": ["send_email"], "de';
  fs.writeFileSync(file, torn);
  const readTool = { name: "memory_search", description: "", input: z.object({}), risk: "read" as const, activity: () => "", execute: async () => null };
  assert.equal((await review(readTool as any, {}, store, "home")).action, "ask", "even reads ask while the policy is broken");
  assert.throws(() => alwaysAllow("other_tool"), /can't be read/);
  assert.equal(fs.readFileSync(file, "utf8"), torn, "left for the user to fix");
  fs.rmSync(file);
});
