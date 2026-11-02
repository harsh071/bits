// Bits Computer: drives Bits' own Chrome over CDP, fast.
//
// Why it is fast:
//  - It reads the page's controls (one isolated-world script) instead of taking screenshots.
//  - `act` runs several steps in one call and returns one fresh snapshot.
//  - It waits for "the page stopped changing" instead of fixed sleeps.
//  - Clicks and typing run immediately. Only outgoing writes (POST/PUT/PATCH/DELETE) that the
//    agent's actions cause are held and passed to `onWrite`, so review happens only when
//    something is about to change.

import { readFileSync } from "node:fs";
import { CdpConnection, attach, type PageSession } from "./cdp.ts";
import { ensureChrome } from "./chrome.ts";
import { formatSnapshot, type RawSnapshot } from "./format.ts";
import { keyEvents } from "./keys.ts";

const WORLD_SRC = readFileSync(new URL("./world.js", import.meta.url), "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One action. Refs are the numbers in a snapshot (`[12] button "Send"`). */
export type Step =
  | { click: number }
  | { type: number; text: string; clear?: boolean; submit?: boolean }
  | { press: string }
  | { select: number; value: string }
  | { hover: number }
  | { scroll: "up" | "down" | number }
  | { navigate: string }
  | { back: true }
  | { wait: number }
  | { dialog: "accept" | "dismiss"; text?: string };

/** Where Bits is about to act, in screen coordinates (for the on-screen buddy). */
export interface Pointer {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  phase: "press" | "type" | "hover" | "idle";
}

export interface WriteRequest {
  method: string;
  url: string;
  body?: string;
  resourceType: string;
  pageUrl: string;
}
export type WriteDecision = "allow" | "deny";

export interface ComputerOptions {
  /** Chrome profile folder. Sign-ins persist here. */
  profileDir: string;
  headless?: boolean;
  chromePath?: string;
  startUrl?: string;
  /** Called before each press/type with where it will happen. */
  onPointer?: (p: Pointer) => void;
  /** Pause after showing the pointer, before pressing, so a person can see it coming. Default 0. */
  leadMs?: number;
  /** Decide on a write the agent's action is about to send. Without it, writes pass. */
  onWrite?: (w: WriteRequest) => Promise<WriteDecision>;
  /** How long the page must be still to count as settled. Default 120 ms. */
  quietMs?: number;
  /** Longest wait for a page to settle after a step. Default 3000 ms. */
  settleMaxMs?: number;
}

export interface Snapshot {
  text: string;
  url: string;
  title: string;
  controls: number;
  ms: number;
}

export interface ActResult {
  ok: boolean;
  /** Steps that finished. */
  done: number;
  error?: string;
  /** Facts seen while acting: navigations, new tabs, writes sent/held/blocked, dialogs. */
  observed: string[];
  snapshot: Snapshot;
  ms: number;
}

class DialogOpen extends Error {}

interface Tab {
  session: PageSession;
  frameId: string;
  ctx: number | null;
  loading: boolean;
  inflight: Map<string, number>;
  dialog: string | null;
  dialogWaiters: Set<() => void>;
  url: string;
}

const WRITE = /^(POST|PUT|PATCH|DELETE)$/;
const short = (url: string) => {
  try {
    const u = new URL(url);
    const p = u.pathname.length > 60 ? u.pathname.slice(0, 59) + "…" : u.pathname;
    return u.host + p;
  } catch {
    return url.slice(0, 80);
  }
};

export class Computer {
  #o: ComputerOptions;
  #conn: CdpConnection;
  #tab!: Tab;
  #kill?: () => void;
  #switching: Promise<void> | null = null;
  #acting = false;
  #activeUntil = 0;
  #observed: string[] | null = null;

  private constructor(o: ComputerOptions, conn: CdpConnection) {
    this.#o = o;
    this.#conn = conn;
  }

  static async start(o: ComputerOptions): Promise<Computer> {
    const chrome = await ensureChrome(o);
    const conn = await CdpConnection.open(chrome.wsUrl);
    const c = new Computer(o, conn);
    c.#kill = o.headless ? chrome.kill : undefined;
    await conn.send("Target.setDiscoverTargets", { discover: true });
    conn.on("Target.targetCreated", ({ targetInfo }) => c.#onTargetCreated(targetInfo));
    conn.on("Target.targetDestroyed", ({ targetId }) => {
      if (c.#tab?.session.targetId === targetId) c.#switching = c.#useAnyPage().finally(() => (c.#switching = null));
    });
    await c.#useAnyPage();
    return c;
  }

  get closed() {
    return this.#conn.closed;
  }

  // ---------------- tabs ----------------

  async #pages() {
    const { targetInfos } = await this.#conn.send<{ targetInfos: { targetId: string; type: string; url: string; title: string }[] }>(
      "Target.getTargets",
    );
    return targetInfos.filter((t) => t.type === "page" && !/^(devtools|chrome-extension):/.test(t.url));
  }

  async #useAnyPage() {
    const pages = await this.#pages();
    const id = pages[0]?.targetId ?? (await this.#conn.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
    await this.#useTarget(id);
  }

  async #useTarget(targetId: string) {
    const session = await attach(this.#conn, targetId);
    const tab: Tab = { session, frameId: "", ctx: null, loading: false, inflight: new Map(), dialog: null, dialogWaiters: new Set(), url: "" };
    session.on("Page.frameStartedLoading", ({ frameId }) => frameId === tab.frameId && (tab.loading = true));
    session.on("Page.frameStoppedLoading", ({ frameId }) => frameId === tab.frameId && (tab.loading = false));
    session.on("Page.frameNavigated", ({ frame }) => {
      if (frame.parentId) return;
      tab.frameId = frame.id;
      tab.url = frame.url;
      tab.ctx = null;
    });
    session.on("Page.navigatedWithinDocument", ({ frameId, url }) => frameId === tab.frameId && (tab.url = url));
    session.on("Page.javascriptDialogOpening", ({ type, message }) => {
      tab.dialog = `${type} ${JSON.stringify(message)}`;
      for (const w of tab.dialogWaiters) w();
    });
    session.on("Page.javascriptDialogClosed", () => (tab.dialog = null));
    session.on("Network.requestWillBeSent", ({ requestId, request, type }) => {
      if (type === "WebSocket" || type === "EventSource") return;
      tab.inflight.set(requestId, Date.now());
      if (!this.#o.onWrite && WRITE.test(request.method) && type !== "Ping") this.#note(`sent ${request.method} ${short(request.url)}`);
    });
    const done = ({ requestId }: { requestId: string }) => tab.inflight.delete(requestId);
    session.on("Network.loadingFinished", done);
    session.on("Network.loadingFailed", done);
    if (this.#o.onWrite) session.on("Fetch.requestPaused", (p) => void this.#onPaused(tab, p));

    await Promise.all([
      session.send("Page.enable"),
      session.send("Network.enable"),
      this.#o.onWrite ? session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }) : null,
    ]);
    const { frameTree } = await session.send("Page.getFrameTree");
    tab.frameId = frameTree.frame.id;
    tab.url = frameTree.frame.url;
    if (!this.#o.headless) await session.send("Page.bringToFront").catch(() => {});
    this.#tab = tab;
  }

  #onTargetCreated(t: { targetId: string; type: string; openerId?: string; url: string }) {
    // A click that opened a new tab: follow it, like a person would.
    if (t.type !== "page" || !this.#isActive() || t.openerId !== this.#tab?.session.targetId) return;
    this.#switching = this.#useTarget(t.targetId)
      .then(() => this.#note("opened a new tab (now using it)"))
      .catch(() => {})
      .finally(() => (this.#switching = null));
  }

  /** Open a URL in the current tab, or a new one. */
  async open(url: string, opts: { newTab?: boolean } = {}): Promise<Snapshot> {
    if (!/^[a-z]+:/i.test(url)) url = `https://${url}`;
    if (opts.newTab) {
      const { targetId } = await this.#conn.send<{ targetId: string }>("Target.createTarget", { url });
      await this.#useTarget(targetId);
      await this.#settle(Date.now());
      return this.snapshot();
    }
    return (await this.act([{ navigate: url }])).snapshot;
  }

  async tabs(): Promise<{ index: number; title: string; url: string; current: boolean }[]> {
    return (await this.#pages()).map((p, index) => ({ index, title: p.title, url: p.url, current: p.targetId === this.#tab.session.targetId }));
  }

  async useTab(index: number): Promise<Snapshot> {
    const p = (await this.#pages())[index];
    if (!p) throw new Error(`No tab ${index}`);
    await this.#useTarget(p.targetId);
    return this.snapshot();
  }

  // ---------------- reading ----------------

  async #eval<T>(contextId: number, expression: string): Promise<T> {
    const r = await this.#tab.session.send("Runtime.evaluate", { expression, contextId, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  /** Reject as soon as a browser dialog (alert/confirm) opens: page work stalls until it is answered. */
  #raceDialog<T>(tab: Tab, p: Promise<T>): Promise<T> {
    p.catch(() => {});
    if (tab.dialog) return Promise.reject(new DialogOpen(tab.dialog));
    let waiter!: () => void;
    const opened = new Promise<never>((_, reject) => {
      waiter = () => reject(new DialogOpen(tab.dialog ?? "dialog"));
      tab.dialogWaiters.add(waiter);
    });
    return Promise.race([p, opened]).finally(() => tab.dialogWaiters.delete(waiter));
  }

  /** Evaluate in Bits' isolated world on the current page, creating it if needed. */
  async #world<T>(expr: string): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      const tab = this.#tab;
      try {
        let ctx = tab.ctx;
        if (ctx == null) {
          const { executionContextId } = await tab.session.send("Page.createIsolatedWorld", { frameId: tab.frameId, worldName: "bits" });
          await this.#raceDialog(tab, this.#eval(executionContextId, WORLD_SRC));
          tab.ctx = ctx = executionContextId as number;
        }
        return await this.#raceDialog(tab, this.#eval<T>(ctx, expr));
      } catch (e) {
        if (e instanceof DialogOpen) throw e;
        last = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (!/context|frame|destroyed|navigat|__bits/i.test(msg)) throw e;
        tab.ctx = null; // the page navigated under us; make a new world
        await sleep(40 * (attempt + 1));
      }
    }
    throw last;
  }

  async snapshot(opts: { all?: boolean; max?: number } = {}): Promise<Snapshot> {
    const t0 = performance.now();
    if (this.#switching) await this.#switching;
    const tab = this.#tab;
    let raw: RawSnapshot;
    try {
      raw = await this.#world<RawSnapshot>(`__bits.snapshot(${JSON.stringify(opts)})`);
    } catch (e) {
      if (!(e instanceof DialogOpen)) throw e;
      raw = { url: tab.url, title: "", modal: null, items: [], above: 0, below: 0 };
    }
    const pages = await this.#pages();
    const tabNote =
      pages.length > 1 ? `Tab ${pages.findIndex((p) => p.targetId === tab.session.targetId) + 1} of ${pages.length}` : undefined;
    return {
      text: formatSnapshot(raw, { tab: tabNote, dialog: tab.dialog }),
      url: raw.url,
      title: raw.title,
      controls: raw.items.length,
      ms: Math.round(performance.now() - t0),
    };
  }

  /** The page's visible text (or the open modal's), for reading content. */
  async text(max = 8000): Promise<string> {
    return this.#world<string>(`__bits.text(${max})`);
  }

  /** A JPEG of the viewport, base64. Fallback for things the controls list can't show (canvas, images). */
  async screenshot(): Promise<string> {
    const { data } = await this.#tab.session.send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
    return data;
  }

  // ---------------- acting ----------------

  #isActive() {
    return this.#acting || Date.now() < this.#activeUntil;
  }

  #note(fact: string) {
    if (this.#observed && this.#observed.at(-1) !== fact) this.#observed.push(fact);
  }

  async #onPaused(tab: Tab, p: { requestId: string; request: { method: string; url: string; postData?: string }; resourceType: string }) {
    const { requestId, request, resourceType } = p;
    const method = request.method.toUpperCase();
    const passes = !WRITE.test(method) || resourceType === "Ping" || resourceType === "CSPViolationReport" || !this.#isActive();
    if (passes || !this.#o.onWrite) {
      await tab.session.send("Fetch.continueRequest", { requestId }).catch(() => {});
      return;
    }
    const label = `${method} ${short(request.url)}`;
    this.#note(`held ${label} for review`);
    let decision: WriteDecision = "deny";
    try {
      decision = await this.#o.onWrite({ method, url: request.url, body: request.postData?.slice(0, 2000), resourceType, pageUrl: tab.url });
    } catch {}
    if (decision === "allow") {
      this.#note(`sent ${label}`);
      await tab.session.send("Fetch.continueRequest", { requestId }).catch(() => {});
    } else {
      this.#note(`blocked ${label}`);
      await tab.session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
    }
  }

  async #settle(since: number): Promise<"settled" | "timeout" | "dialog"> {
    const deadline = Date.now() + (this.#o.settleMaxMs ?? 3000);
    const quietMs = this.#o.quietMs ?? 120;
    await sleep(30);
    for (;;) {
      if (this.#switching) await this.#switching;
      const tab = this.#tab;
      if (tab.dialog) return "dialog";
      const now = Date.now();
      // Requests this step started. Long-lived ones (long polling) stop counting after 5s.
      let busy = tab.loading;
      for (const t of tab.inflight.values()) if (t >= since - 20 && now - t < 5000) busy = true;
      if (!busy) {
        try {
          if ((await this.#world<number>("__bits.quiet()")) >= quietMs) return "settled";
        } catch (e) {
          if (e instanceof DialogOpen) return "dialog";
        }
      }
      if (Date.now() > deadline) return "timeout";
      await sleep(35);
    }
  }

  async #target(ref: number, label: string, phase: Pointer["phase"]) {
    const t = await this.#world<{ x: number; y: number; w: number; h: number; error?: string; cover?: string }>(`__bits.target(${ref})`);
    if (t.error === "gone") throw new Error(`[${ref}] is no longer on the page (it changed). Use the new snapshot.`);
    if (t.error === "hidden") throw new Error(`[${ref}] is hidden right now.`);
    if (t.error === "covered") throw new Error(`[${ref}] is covered by ${t.cover}. Close or move that first.`);
    if (this.#o.onPointer) {
      const g = await this.#world<{ sx: number; sy: number; ow: number; oh: number; iw: number; ih: number }>("__bits.geometry()");
      const left = g.sx + Math.max(0, (g.ow - g.iw) / 2);
      const top = g.sy + Math.max(0, g.oh - g.ih);
      this.#o.onPointer({ x: left + t.x, y: top + t.y, w: t.w, h: t.h, label, phase });
      if (this.#o.leadMs) await sleep(this.#o.leadMs);
    }
    return t;
  }

  async #mouse(type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
    await this.#raceDialog(this.#tab, this.#tab.session.send("Input.dispatchMouseEvent", { type, x, y, ...extra }));
  }

  async #click(x: number, y: number) {
    await this.#mouse("mouseMoved", x, y);
    await this.#mouse("mousePressed", x, y, { button: "left", buttons: 1, clickCount: 1 });
    await this.#mouse("mouseReleased", x, y, { button: "left", buttons: 0, clickCount: 1 });
  }

  async #press(key: string) {
    for (const ev of keyEvents(key)) await this.#raceDialog(this.#tab, this.#tab.session.send("Input.dispatchKeyEvent", ev));
  }

  async #step(s: Step) {
    const session = () => this.#tab.session;
    if ("click" in s) {
      const t = await this.#target(s.click, `click [${s.click}]`, "press");
      return this.#click(t.x, t.y);
    }
    if ("type" in s) {
      const t = await this.#target(s.type, `type into [${s.type}]`, "type");
      await this.#click(t.x, t.y);
      await this.#world(`__bits.prepareType(${s.type}, ${s.clear !== false})`);
      await this.#raceDialog(this.#tab, session().send("Input.insertText", { text: s.text }));
      if (s.submit) await this.#press("Enter");
      return;
    }
    if ("press" in s) return this.#press(s.press);
    if ("select" in s) {
      await this.#target(s.select, `choose in [${s.select}]`, "press");
      const r = await this.#world<string>(`__bits.selectOption(${s.select}, ${JSON.stringify(s.value)})`);
      if (r === "not-select") throw new Error(`[${s.select}] is not a native select. Click it, then click the option.`);
      if (r !== "ok") throw new Error(`[${s.select}]: ${r}`);
      return;
    }
    if ("hover" in s) {
      const t = await this.#target(s.hover, `hover [${s.hover}]`, "hover");
      return this.#mouse("mouseMoved", t.x, t.y);
    }
    if ("scroll" in s) {
      if (typeof s.scroll === "number") {
        await this.#target(s.scroll, `scroll to [${s.scroll}]`, "hover");
        return;
      }
      const g = await this.#world<{ iw: number; ih: number }>("__bits.geometry()");
      const dy = (s.scroll === "down" ? 1 : -1) * Math.round(g.ih * 0.8);
      return this.#mouse("mouseWheel", g.iw / 2, g.ih / 2, { deltaX: 0, deltaY: dy });
    }
    if ("navigate" in s) {
      const r = await session().send("Page.navigate", { url: s.navigate });
      if (r.errorText) throw new Error(`Could not open ${s.navigate}: ${r.errorText}`);
      this.#tab.loading = true;
      return;
    }
    if ("back" in s) {
      const h = await session().send("Page.getNavigationHistory");
      const prev = h.entries[h.currentIndex - 1];
      if (!prev) throw new Error("No previous page");
      await session().send("Page.navigateToHistoryEntry", { entryId: prev.id });
      return;
    }
    if ("wait" in s) return sleep(Math.min(Math.max(0, s.wait), 10_000));
    if ("dialog" in s) {
      if (!this.#tab.dialog) throw new Error("No browser dialog is open");
      await session().send("Page.handleJavaScriptDialog", { accept: s.dialog === "accept", promptText: s.text });
      this.#tab.dialog = null;
      return;
    }
    throw new Error(`Unknown step ${JSON.stringify(s)}`);
  }

  /** Run steps in order; stop at the first failure. Returns what was observed and a fresh snapshot. */
  async act(steps: Step[]): Promise<ActResult> {
    const t0 = performance.now();
    const observed: string[] = [];
    this.#observed = observed;
    this.#acting = true;
    const startUrl = this.#tab.url;
    let done = 0;
    let error: string | undefined;
    try {
      for (const s of steps) {
        if (this.#switching) await this.#switching;
        const since = Date.now();
        try {
          await this.#step(s);
        } catch (e) {
          if (!(e instanceof DialogOpen)) {
            error = `Step ${done + 1} ${JSON.stringify(s)} failed: ${e instanceof Error ? e.message : String(e)}`;
            break;
          }
        }
        const settled = await this.#settle(since);
        done++;
        if (settled === "dialog") {
          this.#note(`browser dialog opened: ${this.#tab.dialog}`);
          const next = steps[done];
          if (next && !("dialog" in next)) {
            error = "A browser dialog opened; the remaining steps were not run. Answer it with a dialog step.";
            break;
          }
        } else if (settled === "timeout") this.#note("page was still busy when Bits moved on");
      }
    } finally {
      this.#acting = false;
      this.#activeUntil = Date.now() + 1500; // writes debounced by the page still count as caused by Bits
      this.#o.onPointer?.({ x: 0, y: 0, w: 0, h: 0, label: "", phase: "idle" });
    }
    const snapshot = await this.snapshot();
    if (snapshot.url !== startUrl) observed.unshift(`now at ${snapshot.url}`);
    this.#observed = null;
    return { ok: !error, done, error, observed, snapshot, ms: Math.round(performance.now() - t0) };
  }

  /** Disconnect. Bits' Chrome keeps running unless this process started it headless. */
  close() {
    this.#conn.close();
    this.#kill?.();
  }
}
