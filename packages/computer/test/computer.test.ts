// Runs a headless Chrome against a small local page. Skips when no Chrome is installed.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { ActionLog, Computer, findChrome, formatTimeline, type LogEntry, type WriteRequest } from "../src/index.ts";
import { keyEvents } from "../src/keys.ts";

const PAGE = `<!doctype html><title>Fixture</title>
<style>body{font:14px sans-serif} .far{margin-top:3000px} #cover{position:fixed;inset:0 auto auto 0;width:200px;height:60px;background:#eee}</style>
<h1>Orders</h1>
<label>Name <input id="name" value="old"></label>
<select id="size"><option>Small</option><option>Large</option></select>
<label><input type="checkbox" id="gift"> Gift wrap</label>
<button id="save" onclick="fetch('/api/save',{method:'POST',body:document.getElementById('name').value}).then(r=>document.getElementById('out').textContent='saved:'+r.status).catch(()=>document.getElementById('out').textContent='save failed')">Save</button>
<button id="del" onclick="if(confirm('Delete order?'))document.getElementById('out').textContent='deleted'">Delete</button>
<div id="row" style="cursor:pointer" onmousedown="document.getElementById('out').textContent='row'">Open row</div>
<form onsubmit="event.preventDefault();document.getElementById('out').textContent='searched:'+this.q.value"><input name="q" placeholder="Search"></form>
<a href="/two">Next page</a>
<input type="password" aria-label="Password">
<button onclick="window.open('/two')">Pop out</button>
<button onclick="document.getElementById('dlg').showModal()">Open modal</button>
<dialog id="dlg"><h2>Confirm</h2><button onclick="this.closest('dialog').close()">Close modal</button></dialog>
<p id="out"></p>
<button class="far" onclick="document.getElementById('out').textContent='far'">Far away</button>`;

const chrome = findChrome();

describe("Computer", { skip: !chrome && "no Chrome installed" }, () => {
  let server: http.Server;
  let base = "";
  const posts: string[] = [];
  let decide: (w: WriteRequest) => "allow" | "deny" = () => "allow";
  const logged: LogEntry[] = [];
  const held: WriteRequest[] = [];
  let c: Computer;
  let profile = "";

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          posts.push(body);
          res.end("ok");
        });
        return;
      }
      res.setHeader("content-type", "text/html");
      if (req.url === "/two") return res.end("<title>Two</title><h1>Page two</h1><button>Hello</button>");
      if (req.url === "/covered") return res.end(PAGE + '<div style="position:fixed;inset:0;background:#fff">Cookie banner</div>');
      res.end(PAGE);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    profile = mkdtempSync(path.join(tmpdir(), "bits-computer-test-"));
    c = await Computer.start({
      profileDir: profile,
      headless: true,
      onLog: (e) => void logged.push(e),
      onWrite: async (w) => {
        held.push(w);
        const decision = decide(w);
        return { decision, by: "test", reason: decision === "deny" ? "not asked for" : "asked for" };
      },
    });
  });

  after(() => {
    c?.close();
    server?.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  });

  const ref = (text: string, label: string) => {
    const line = text.split("\n").find((l) => l.includes(`"${label}"`));
    assert.ok(line, `no control "${label}" in:\n${text}`);
    return Number(/^\[(\d+)\]/.exec(line)![1]);
  };

  test("snapshot lists controls with refs, states and headings", async () => {
    const s = await c.open(base);
    assert.match(s.text, /Page: Fixture/);
    assert.match(s.text, /heading "Orders"/);
    assert.match(s.text, /textbox "Name" value="old"/);
    assert.match(s.text, /combobox "Size|combobox "" value="Small"/);
    assert.match(s.text, /checkbox "Gift wrap" checked=false/);
    assert.match(s.text, /clickable "Open row"/);
    assert.match(s.text, /more controls below/);
    assert.doesNotMatch(s.text, /Far away/);
    assert.ok(s.ms < 500, `snapshot took ${s.ms}ms`);
  });

  test("refs stay the same between snapshots", async () => {
    const a = await c.snapshot();
    const b = await c.snapshot();
    assert.equal(ref(a.text, "Save"), ref(b.text, "Save"));
  });

  test("type replaces the value, select and checkbox work, in one act", async () => {
    const s = await c.snapshot();
    const r = await c.act([
      { type: ref(s.text, "Name"), text: "Sam" },
      { select: Number(/\[(\d+)\] combobox/.exec(s.text)![1]), value: "large" },
      { click: ref(s.text, "Gift wrap") },
    ]);
    assert.equal(r.ok, true, r.error ?? "");
    assert.equal(r.done, 3);
    assert.match(r.snapshot.text, /textbox "Name" value="Sam"/);
    assert.match(r.snapshot.text, /value="Large"/);
    assert.match(r.snapshot.text, /checkbox "Gift wrap" checked=true/);
  });

  test("an allowed write is held, reviewed, then sent", async () => {
    decide = () => "allow";
    held.length = 0;
    posts.length = 0;
    const s = await c.snapshot();
    const r = await c.act([{ click: ref(s.text, "Save") }]);
    assert.equal(r.ok, true, r.error ?? "");
    assert.equal(held.length, 1);
    assert.equal(held[0]!.method, "POST");
    assert.deepEqual(posts, ["Sam"]);
    assert.ok(r.observed.some((o) => o.startsWith("sent POST")), r.observed.join("; "));
    assert.equal(await outText(c), "saved:200");
  });

  test("a denied write never reaches the server", async () => {
    decide = () => "deny";
    posts.length = 0;
    const s = await c.snapshot();
    const r = await c.act([{ click: ref(s.text, "Save") }]);
    assert.deepEqual(posts, []);
    assert.ok(r.observed.some((o) => o.startsWith("blocked POST")), r.observed.join("; "));
    assert.equal(await outText(c), "save failed");
    decide = () => "allow";
  });

  test("submit with Enter, and pointer-cursor elements are clickable", async () => {
    const s = await c.snapshot();
    let r = await c.act([{ click: ref(s.text, "Open row") }]);
    assert.equal(await outText(c), "row");
    r = await c.act([{ type: ref(s.text, "Search"), text: "shoes", submit: true }]);
    assert.equal(r.ok, true, r.error ?? "");
    assert.equal(await outText(c), "searched:shoes");
  });

  test("off-screen controls are scrolled into view before pressing", async () => {
    const s = await c.snapshot({ all: true });
    const r = await c.act([{ click: ref(s.text, "Far away") }]);
    assert.equal(r.ok, true, r.error ?? "");
    assert.equal(await outText(c), "far");
    await c.act([{ scroll: "up" }, { scroll: "up" }, { scroll: "up" }, { scroll: "up" }, { scroll: "up" }]);
  });

  test("a confirm() dialog stops the run and can be answered", async () => {
    const s = await c.snapshot();
    const r = await c.act([{ click: ref(s.text, "Delete") }, { click: ref(s.text, "Save") }]);
    assert.equal(r.ok, false);
    assert.match(r.observed.join("; "), /browser dialog opened: confirm "Delete order\?"/);
    assert.match(r.snapshot.text, /Browser dialog open/);
    const r2 = await c.act([{ dialog: "accept" }]);
    assert.equal(r2.ok, true, r2.error ?? "");
    assert.equal(await outText(c), "deleted");
  });

  test("a modal limits the snapshot to its contents", async () => {
    const s = await c.snapshot();
    const r = await c.act([{ click: ref(s.text, "Open modal") }]);
    assert.match(r.snapshot.text, /Modal open/);
    assert.match(r.snapshot.text, /Close modal/);
    assert.doesNotMatch(r.snapshot.text, /"Save"/);
    await c.act([{ click: ref(r.snapshot.text, "Close modal") }]);
  });

  test("covered controls are reported, not mis-clicked", async () => {
    const s = await c.open(`${base}/covered`);
    const r = await c.act([{ click: ref(s.text, "Name") }]);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /covered by/);
    // The banner itself is not a control; the page under it is still listed, so the model can see why.
  });

  test("links navigate and new tabs are followed", async () => {
    await c.act([{ navigate: base }]);
    let s = await c.snapshot();
    let r = await c.act([{ click: ref(s.text, "Next page") }]);
    assert.equal(r.snapshot.title, "Two");
    assert.ok(r.observed[0]?.startsWith("now at"));
    r = await c.act([{ back: true }]);
    assert.equal(r.snapshot.title, "Fixture");
    s = r.snapshot;
    r = await c.act([{ click: ref(s.text, "Pop out") }]);
    assert.ok(r.observed.some((o) => o.includes("new tab")), r.observed.join("; "));
    assert.equal(r.snapshot.title, "Two");
    assert.match(r.snapshot.text, /Tab \d of 2/);
  });

  test("the log ties each write to the step that caused it", async () => {
    await c.act([{ navigate: base }]);
    logged.length = 0;
    const s = await c.snapshot();
    decide = () => "deny";
    await c.act([{ type: ref(s.text, "Name"), text: "Ann" }, { click: ref(s.text, "Save") }], { task: "save the order", turn: "t1" });
    decide = () => "allow";
    const act = logged.find((e) => e.kind === "act");
    assert.ok(act && act.kind === "act");
    assert.equal(act.task, "save the order");
    assert.equal(act.turn, "t1");
    const steps = logged.filter((e) => e.kind === "step");
    assert.deepEqual(steps.map((e) => e.kind === "step" && [e.action, e.target?.name, e.ok]), [["type", "Name", true], ["click", "Save", true]]);
    const write = logged.find((e) => e.kind === "effect" && e.type === "write");
    assert.ok(write && write.kind === "effect");
    assert.equal(write.step, 1, "caused by step 2, the click");
    assert.equal(write.act, act.act);
    assert.equal(write.outcome, "blocked");
    assert.equal(write.by, "test");
    assert.equal(write.reason, "not asked for");
    assert.equal(write.bodyBytes, 3);
    assert.doesNotMatch(JSON.stringify(logged), /"body"/, "request bodies are not stored");
    assert.ok(logged.at(-1)?.kind === "act.end");
  });

  test("text typed into a password field is not logged", async () => {
    logged.length = 0;
    const s = await c.snapshot();
    await c.act([{ type: ref(s.text, "Password"), text: "hunter2" }]);
    assert.doesNotMatch(JSON.stringify(logged), /hunter2/);
    assert.match(JSON.stringify(logged), /•••/);
  });

  test("navigations are logged, without query strings", async () => {
    logged.length = 0;
    await c.act([{ navigate: `${base}/two?token=secret` }]);
    const nav = logged.find((e) => e.kind === "effect" && e.type === "navigate");
    assert.ok(nav && nav.kind === "effect");
    assert.equal(nav.url, `${base}/two`);
    assert.doesNotMatch(JSON.stringify(logged), /secret/);
  });

  test("a vanished ref gives a clear error", async () => {
    const r = await c.act([{ click: 99999 }]);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /no longer on the page/);
  });
});

test("key combos map to CDP events", () => {
  const [down] = keyEvents("Enter");
  assert.equal(down!.type, "keyDown");
  assert.equal(down!.text, "\r");
  const [chord] = keyEvents("Meta+a");
  assert.equal(chord!.type, "rawKeyDown");
  assert.equal(chord!.modifiers, 4);
  assert.throws(() => keyEvents("Hyper+x"));
});

async function outText(c: Computer) {
  const t = await c.text(4000);
  const m = /^(saved:\d+|save failed|deleted|row|searched:\S+|far)$/m.exec(t);
  return m?.[1] ?? "";
}

test("ActionLog writes one file per day and reads it back as a timeline", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bits-log-test-"));
  try {
    const log = new ActionLog(dir);
    const at = new Date().toISOString();
    log.write({ v: 1, kind: "act", act: "a1", at, url: "https://mail.example.com/", steps: 1, task: "archive the top email" });
    log.write({ v: 1, kind: "step", act: "a1", step: 0, at, action: "click", ref: 12, target: { role: "button", name: "Archive" }, ok: true, ms: 84, url: "https://mail.example.com/" });
    log.write({ v: 1, kind: "effect", act: "a1", step: 0, at, type: "write", method: "POST", url: "https://mail.example.com/sync", outcome: "allowed", by: "you" });
    log.write({ v: 1, kind: "act.end", act: "a1", at, ok: true, done: 1, ms: 300, url: "https://mail.example.com/" });
    assert.equal(log.days().length, 1);
    const entries = log.read();
    assert.equal(entries.length, 4);
    const t = formatTimeline(entries);
    assert.match(t, /"archive the top email"/);
    assert.match(t, /✓ 1\. click button "Archive"/);
    assert.match(t, /⏸ → sent POST mail\.example\.com\/sync by you/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
