// Bits' browser: tools that let the agent use websites in its own Chrome (@bits/computer).
//
// - One Chrome, started on first use, with its own profile (~/.bits/chrome): sign in once.
// - Browser tool calls run one at a time, even across conversations, because they share the page.
// - Clicking and typing run freely. A send the agent's action causes (POST/PUT/PATCH/DELETE) is
//   held inside Chrome and reviewed by the Sentinel against the user's own words. If it isn't
//   clearly asked for, it is blocked, and the model is told to ask the user and then try again.
// - Every step and what it caused goes to the action log (~/.bits/actions), shown on the
//   Browser activity page.

import { z } from "zod";
import { ActionLog, Computer, redactUrl, type Decision, type Step, type WriteRequest } from "@bits/computer";
import { config } from "../config.ts";
import type { Store } from "../store.ts";
import { review } from "./sentinel.ts";
import type { ToolContext, ToolDef } from "./tools.ts";

const log = new ActionLog(config.paths.actions);

let computer: Promise<Computer> | null = null;
let current: { ctx: ToolContext; blocked: string[] } | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** Decisions already made this turn, so a page that retries a request isn't reviewed twice. */
const decided = new Map<string, Decision>();

// Tracking beacons aren't something the user asked for. Block them without spending a review.
const TRACKERS = /(^|\.)(google-analytics\.com|analytics\.google\.com|doubleclick\.net|googletagmanager\.com|segment\.(io|com)|mixpanel\.com|amplitude\.com|hotjar\.(com|io)|clarity\.ms|sentry\.io|posthog\.com|facebook\.com|datadoghq\.com|newrelic\.com|nr-data\.net|fullstory\.com)$/;

function browser(): Promise<Computer> {
  if (!computer) {
    computer = Computer.start({
      profileDir: config.paths.chrome,
      headless: process.env.BITS_BROWSER_HEADLESS === "1",
      onLog: log.write,
      onWrite: decide,
    }).catch((e) => {
      computer = null;
      throw e;
    });
  }
  return computer.then(async (c) => {
    if (!c.closed) return c;
    computer = null; // Chrome was closed; start it again
    return browser();
  });
}

/** Run browser work one call at a time, with the calling turn as the context for reviews. */
function exclusive<T>(ctx: ToolContext, fn: (c: Computer) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    current = { ctx, blocked: [] };
    try {
      return await fn(await browser());
    } finally {
      current = null;
    }
  });
  queue = run.catch(() => {});
  return run;
}

async function decide(w: WriteRequest): Promise<Decision> {
  const turn = current;
  if (!turn) return { decision: "deny", by: "bits", reason: "no task was running" };
  let host = "";
  try {
    host = new URL(w.url).hostname;
  } catch {}
  if (TRACKERS.test(host)) return { decision: "deny", by: "bits", reason: "tracking request" };

  const key = `${turn.ctx.turnId}|${w.method} ${redactUrl(w.url)}`;
  const known = decided.get(key);
  if (known) return known;

  // Reviewed like any other risky tool call: your policy.json can allow/ask/deny `browser_send__<host>`.
  const def: ToolDef = {
    name: `browser_send__${host}`,
    description: "Send data from a web page in Bits' browser to a website: submitting a form, sending a message, saving, deleting, buying.",
    input: { jsonSchema: {} },
    risk: "external",
    activity: () => "",
    execute: async () => null,
  };
  const verdict = await review(
    def,
    { method: w.method, url: redactUrl(w.url), fromPage: redactUrl(w.pageUrl), body: w.body?.slice(0, 800) },
    turn.ctx.store as Store,
    turn.ctx.conversationId,
  );
  const d: Decision =
    verdict.action === "run"
      ? { decision: "allow", by: "sentinel", reason: "matches what you asked" }
      : { decision: "deny", by: verdict.action === "deny" ? "policy" : "sentinel", reason: verdict.reason };
  decided.set(key, d);
  if (decided.size > 500) decided.delete(decided.keys().next().value!);
  if (d.decision === "deny") turn.blocked.push(`${w.method} ${redactUrl(w.url)} — ${d.reason}`);
  return d;
}

/** What the model reads back after a browser call. */
function report(r: { ok?: boolean; done?: number; error?: string; observed?: string[]; ms: number; text: string }, steps?: number) {
  const lines: string[] = [];
  if (steps !== undefined) lines.push(`${r.ok ? "Done" : "Stopped"}: ${r.done}/${steps} step(s) in ${r.ms}ms.`);
  if (r.error) lines.push(r.error);
  if (r.observed?.length) lines.push(`Observed: ${r.observed.join("; ")}`);
  const blocked = current?.blocked ?? [];
  if (blocked.length) {
    lines.push(
      `The safety check blocked ${blocked.length === 1 ? "a send" : "sends"} (${blocked.join("; ")}). Nothing was sent. ` +
        "If the user wants this, ask them with ask_user, saying exactly what will be sent where. Once they say yes, repeat the step.",
    );
  }
  lines.push("", r.text);
  return lines.join("\n");
}

const ref = z.number().int().describe("a [number] from the latest snapshot");
const StepSchema = z.union([
  z.object({ click: ref }),
  z.object({ type: ref, text: z.string(), clear: z.boolean().optional().describe("replace what's there (default true)"), submit: z.boolean().optional().describe("press Enter after") }),
  z.object({ press: z.string().describe('a key or combo: "Enter", "Escape", "Tab", "ArrowDown", "Meta+a"') }),
  z.object({ select: ref, value: z.string().describe("option text or value") }),
  z.object({ hover: ref }),
  z.object({ scroll: z.union([z.enum(["up", "down"]), ref]) }),
  z.object({ navigate: z.string() }),
  z.object({ back: z.literal(true) }),
  z.object({ wait: z.number().max(10_000).describe("milliseconds") }),
  z.object({ dialog: z.enum(["accept", "dismiss"]), text: z.string().optional() }),
]);

const host = (url: string) => {
  try {
    return new URL(/^[a-z]+:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "a page";
  }
};

/** The user's message that started this turn, written to the log as the task. */
function taskOf(ctx: ToolContext): string | undefined {
  const m = ctx.store.lastMessages(ctx.conversationId, 30).filter((m) => m.role === "user").at(-1);
  const text = m?.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
  return text ? text.slice(0, 200) : undefined;
}

export const browserTools: ToolDef[] = [
  {
    name: "browser_open",
    description:
      "Open a web page in your own browser (Chrome, signed in to the user's sites) and get its controls as a numbered list. Use for websites that need the user's login or clicking (email, shopping, bookings, dashboards). For reading public pages, web_fetch is cheaper.",
    input: z.object({ url: z.string(), newTab: z.boolean().optional() }),
    risk: "read",
    mainOnly: true, // helpers would fight over the one page
    activity: (i) => `Opening ${host(i.url)}`,
    execute: ({ url, newTab }, ctx) =>
      exclusive(ctx, async (c) => {
        if (/^(file|chrome|devtools|javascript|data):/i.test(url)) throw new Error("Only web pages can be opened");
        if (newTab) return report(await c.open(url, { newTab: true }));
        const r = await c.act([{ navigate: /^[a-z]+:/i.test(url) ? url : `https://${url}` }], { task: taskOf(ctx), turn: ctx.turnId });
        return report({ ...r, text: r.snapshot.text }, 1);
      }),
  },
  {
    name: "browser_snapshot",
    description: "The current page's controls as a numbered list ([12] button \"Send\"). Visible area only, unless all is true.",
    input: z.object({ all: z.boolean().optional() }),
    risk: "read",
    mainOnly: true, // helpers would fight over the one page
    activity: () => "Looking at the page",
    execute: ({ all }, ctx) => exclusive(ctx, async (c) => report(await c.snapshot({ all }))),
  },
  {
    name: "browser_act",
    description: `Do several things on the current page in one call, in order, using [numbers] from the latest snapshot. Returns what happened and the new snapshot.
Steps: {"click":12} {"type":4,"text":"milk","submit":true} {"press":"Escape"} {"select":7,"value":"Large"} {"hover":3} {"scroll":"down"} {"navigate":"https://…"} {"back":true} {"wait":500} {"dialog":"accept"}.
Batch steps you're sure of (fill a whole form, then submit). Stops at the first failure. Sends to websites (submitting, sending, buying, deleting) are checked against what the user asked; unclear ones are blocked.`,
    input: z.object({ steps: z.array(StepSchema).min(1).max(20) }),
    mainOnly: true,
    risk: "write", // runs freely: the effects (sends) are reviewed one by one inside the browser
    activity: (i) => {
      const s = i.steps[0];
      const verb = s ? Object.keys(s)[0] : "act";
      return `Browser: ${verb}${i.steps.length > 1 ? ` +${i.steps.length - 1}` : ""}`;
    },
    execute: ({ steps }, ctx) =>
      exclusive(ctx, async (c) => {
        const r = await c.act(steps as Step[], { task: taskOf(ctx), turn: ctx.turnId });
        return report({ ...r, text: r.snapshot.text }, steps.length);
      }),
  },
  {
    name: "browser_read",
    description: "The visible text of the current page (or of an open modal), for reading content like an email or an article.",
    input: z.object({ maxChars: z.number().int().min(500).max(30_000).optional() }),
    risk: "read",
    mainOnly: true, // helpers would fight over the one page
    activity: () => "Reading the page",
    execute: ({ maxChars }, ctx) => exclusive(ctx, (c) => c.text(maxChars ?? 8000)),
  },
  {
    name: "browser_tabs",
    description: "List the browser's open tabs, or switch to one by index.",
    input: z.object({ switchTo: z.number().int().optional() }),
    risk: "read",
    mainOnly: true, // helpers would fight over the one page
    activity: (i) => (i.switchTo === undefined ? "Checking tabs" : "Switching tab"),
    execute: ({ switchTo }, ctx) =>
      exclusive(ctx, async (c) => (switchTo === undefined ? c.tabs() : report(await c.useTab(switchTo)))),
  },
];

/** Disconnect from Chrome (headless Chrome started by Bits is shut down; a visible one stays open). */
export async function closeBrowser() {
  const c = computer;
  computer = null;
  if (c) (await c.catch(() => null))?.close();
}
