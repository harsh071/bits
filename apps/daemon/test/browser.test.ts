// End to end: a chat turn uses the browser, and a send it causes is reviewed by the Sentinel.
// Uses a headless Chrome against a local page. Skips when no Chrome is installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { findChrome } from "@bits/computer";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "bits-browser-"));
process.env.BITS_HOME = home;
process.env.BITS_MODEL = "mock:main";
process.env.BITS_FAST_MODEL = "mock:fast";
process.env.BITS_BROWSER_HEADLESS = "1";

const { setModelResolver } = await import("../src/models.ts");
const { openDb } = await import("../src/db.ts");
const memory = await import("../src/memory.ts");
const { Store } = await import("../src/store.ts");
const { Runtime } = await import("../src/agent/runtime.ts");
const { Artifacts } = await import("../src/artifacts.ts");
const { closeBrowser } = await import("../src/agent/browser.ts");
const { ActionLog } = await import("@bits/computer");

type Step = { text?: string; calls?: { name: string; input: unknown }[] };
let script: Step[] = [];
let verdict = '{"verdict":"ask","reason":"Saving data needs your OK."}';
let reviews = 0;
let callNo = 0;
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };

setModelResolver((id) =>
  id === "mock:fast"
    ? new MockLanguageModelV4({
        doGenerate: async () => {
          reviews++;
          return { content: [{ type: "text", text: verdict }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] } as any;
        },
      })
    : new MockLanguageModelV4({
        doStream: async () => {
          const step = script.shift();
          if (!step) throw new Error("script exhausted");
          const parts: any[] = [{ type: "stream-start", warnings: [] }];
          if (step.text) parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
          for (const c of step.calls ?? []) parts.push({ type: "tool-call", toolCallId: `call_${++callNo}`, toolName: c.name, input: JSON.stringify(c.input) });
          parts.push({ type: "finish", finishReason: { unified: step.calls?.length ? "tool-calls" : "stop", raw: undefined }, usage });
          return { stream: convertArrayToReadableStream(parts) } as any;
        },
      }),
);

// [1] textbox "Name"  [2] button "Save"
const PAGE = `<!doctype html><title>Profile</title>
<input aria-label="Name"><button onclick="fetch('/api/save',{method:'POST',body:document.querySelector('input').value}).then(()=>document.title='saved').catch(()=>document.title='failed')">Save</button>`;
const posts: string[] = [];
const server = http.createServer((req, res) => {
  if (req.method === "POST") {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => (posts.push(b), res.end("ok")));
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(PAGE);
});

memory.initHome();
const db = openDb(path.join(home, "state.db"));
const store = new Store(db);
const runtime = new Runtime(store, new Artifacts());
let url = "";

async function until(pred: () => boolean, ms = 20_000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  runtime.start();
});
after(async () => {
  runtime.stop();
  await closeBrowser();
  server.close();
  db.close();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 });
});

const run = async (id: string, text: string) => {
  const conv = store.createConversation(id);
  const { turnId } = runtime.sendMessage(conv.id, { id, text });
  await until(() => ["done", "failed"].includes(store.getTurn(turnId!)?.status ?? ""));
  assert.equal(store.getTurn(turnId!)?.status, "done");
  return store
    .getMessages(conv.id)
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.parts.filter((p) => p.type === "tool-result")) as any[];
};

test("a send the user didn't clearly ask for is blocked, logged, and explained to the model", { skip: !findChrome() && "no Chrome" }, async () => {
  verdict = '{"verdict":"ask","reason":"Saving data needs your OK."}';
  script = [
    { calls: [{ name: "browser_open", input: { url } }] },
    { calls: [{ name: "browser_act", input: { steps: [{ type: 1, text: "Sam" }, { click: 2 }] } }] },
    { text: "I need your OK to save." },
  ];
  const results = await run("b1", "look at my profile page");
  assert.match(String(results[0].output), /\[1\] textbox "Name"/);
  const act = String(results[1].output);
  assert.equal(results[1].isError, false, act);
  assert.match(act, /safety check blocked a send/);
  assert.match(act, /ask_user/);
  assert.deepEqual(posts, [], "nothing reached the server");
  assert.ok(reviews >= 1);

  const entries = new ActionLog(path.join(home, "actions")).read();
  const blocked = entries.find((e) => e.kind === "effect" && e.type === "write");
  assert.ok(blocked && blocked.kind === "effect");
  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.by, "sentinel");
  assert.equal(blocked.reason, "Saving data needs your OK.");
  const actEntry = entries.find((e) => e.kind === "act" && e.task === "look at my profile page");
  assert.ok(actEntry, "the user's request is the logged task");
});

test("a send the user asked for goes through", { skip: !findChrome() && "no Chrome" }, async () => {
  verdict = '{"verdict":"allow"}';
  posts.length = 0;
  script = [
    { calls: [{ name: "browser_open", input: { url } }] },
    { calls: [{ name: "browser_act", input: { steps: [{ type: 1, text: "Sam" }, { click: 2 }] } }] },
    { text: "Saved." },
  ];
  const results = await run("b2", "set my profile name to Sam and save it");
  assert.doesNotMatch(String(results[1].output), /blocked/);
  assert.deepEqual(posts, ["Sam"]);
  const writes = new ActionLog(path.join(home, "actions")).read().filter((e) => e.kind === "effect" && e.type === "write");
  const last = writes.at(-1);
  assert.ok(last && last.kind === "effect");
  assert.equal(last.outcome, "allowed");
});
