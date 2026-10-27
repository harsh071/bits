import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { HealthInfo, MemoryOverview, ServerEvent, VoiceConfig } from "@bits/protocol";
import { bus } from "./bus.ts";
import { config } from "./config.ts";
import * as memory from "./memory.ts";
import type { Store } from "./store.ts";
import type { Runtime } from "./agent/runtime.ts";
import type { Scheduler } from "./scheduler.ts";
import { connectors } from "./connectors.ts";
import { localOnly } from "./guard.ts";
import { speechToText, textToSpeech } from "./voice.ts";
import type { Artifacts } from "./artifacts.ts";
import type { Telegram } from "./channels/telegram.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

export function createApp(store: Store, runtime: Runtime, scheduler: Scheduler, artifacts: Artifacts, telegram?: Telegram) {
  const app = new Hono();

  app.onError((err, c) => {
    console.error("[bits] request failed:", err);
    return c.json({ error: String(err.message ?? err) }, 400);
  });

  // Block cross-site requests and DNS rebinding: a web page you visit must not be able to drive your agent.
  app.use("*", localOnly());

  // Optional bearer token (set BITS_TOKEN when exposing the daemon beyond localhost).
  app.use("/api/*", async (c, next) => {
    if (!config.token) return next();
    const auth = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? c.req.query("token");
    if (auth !== config.token) return c.json({ error: "unauthorized" }, 401);
    return next();
  });

  app.get("/api/health", (c) =>
    c.json({ ok: true, name: "bits", version: config.version, model: config.model, home: config.home } satisfies HealthInfo),
  );

  app.get("/api/status", (c) => c.json({ model: config.model, fastModel: config.fastModel, voice: config.voice, connectors: connectors.overview().connectors.map(({ name, state, tools, error }) => ({ name, ok: state === "connected", state, tools: tools.length, error })) }));

  // ----- live updates -----
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const queue: ServerEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = bus.subscribe((e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ data: JSON.stringify({ type: "hello", serverTime: Date.now() } satisfies ServerEvent) });
      while (!stream.aborted) {
        if (!queue.length) {
          await new Promise<void>((r) => {
            wake = r;
            setTimeout(r, 15_000);
          });
          wake = null;
          if (!queue.length && !stream.aborted) await stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
        }
        while (queue.length && !stream.aborted) await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
      }
      unsubscribe();
    }),
  );

  // ----- conversations -----
  app.get("/api/conversations", (c) => c.json(store.listConversations()));
  app.post("/api/conversations", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(store.createConversation(body.title || undefined));
  });
  app.get("/api/conversations/:id/messages", (c) => {
    const id = c.req.param("id");
    if (!store.getConversation(id)) return c.json({ error: "not found" }, 404);
    const after = Number(c.req.query("after") ?? 0);
    const limit = Math.min(Number(c.req.query("limit") ?? 1000), 5000);
    const messages = store.getMessages(id, after, limit);
    return c.json({ messages, lastSeq: store.getConversation(id)!.lastSeq, turn: store.activeTurn(id) });
  });
  app.post("/api/conversations/:id/messages", async (c) => {
    const id = c.req.param("id");
    if (!store.getConversation(id)) return c.json({ error: "not found" }, 404);
    return c.json(runtime.sendMessage(id, await c.req.json()));
  });
  app.post("/api/conversations/:id/cancel", (c) => {
    runtime.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/conversations/:id/compact", async (c) => c.json({ compacted: await runtime.compact(c.req.param("id"), { force: true }) }));

  // ----- approvals -----
  app.get("/api/approvals", (c) => c.json(store.listApprovals((c.req.query("status") as any) || undefined)));
  app.post("/api/approvals/:id", async (c) => {
    const { decision } = await c.req.json();
    if (!["approve", "deny", "always"].includes(decision)) return c.json({ error: "decision must be approve|deny|always" }, 400);
    const approval = runtime.decideApproval(c.req.param("id"), decision);
    return approval ? c.json(approval) : c.json({ error: "not found" }, 404);
  });

  // ----- memory -----
  app.get("/api/memory", (c) =>
    c.json({
      home: config.home,
      profile: memory.readProfile(),
      logs: memory.listLogs(),
      skills: memory.listSkills().map(({ name, description }) => ({ name, description })),
      routines: scheduler.overview(),
    } satisfies MemoryOverview),
  );
  app.put("/api/memory/profile", async (c) => {
    const { content } = await c.req.json();
    memory.writeProfile(String(content ?? ""));
    memory.reindex(store.db);
    return c.json({ ok: true });
  });
  app.get("/api/memory/log/:month", (c) => c.json({ content: memory.readLog(c.req.param("month")) }));
  app.get("/api/memory/search", (c) => c.json(memory.search(store.db, c.req.query("q") ?? "")));
  app.get("/api/skills/:name", (c) => {
    const s = memory.readSkill(c.req.param("name"));
    return s ? c.json({ name: s.name, description: s.description, content: s.body }) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/routines/:name/run", (c) => c.json({ turnId: scheduler.runNow(c.req.param("name")) }));
  app.patch("/api/routines/:name", async (c) => {
    const { enabled } = await c.req.json();
    memory.setRoutineEnabled(c.req.param("name"), !!enabled);
    return c.json({ ok: true });
  });

  // ----- artifacts -----
  app.get("/api/artifacts", (c) => c.json(artifacts.list()));
  app.get("/api/artifacts/:id", (c) => {
    const id = c.req.param("id");
    if (!artifacts.exists(id)) return c.json({ error: "not found" }, 404);
    return c.json(artifacts.get(id));
  });
  app.get("/api/artifacts/:id/activity", (c) => c.json(artifacts.activity(c.req.param("id"), 100)));
  // Run a declared action. `by` is "person" for UI clicks and "agent" for WebMCP calls from browser agents.
  app.post("/api/artifacts/:id/actions/:action", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const by = body.by === "agent" ? "agent" : "person";
    const result = await artifacts.runAction(c.req.param("id"), c.req.param("action"), body.input ?? {}, by);
    return c.json(result);
  });

  // ----- connectors -----
  app.get("/api/connectors", (c) => c.json(connectors.overview()));
  app.post("/api/connectors", async (c) => c.json(await connectors.add(await c.req.json())));
  app.delete("/api/connectors/:name", async (c) => {
    await connectors.remove(c.req.param("name"));
    return c.json({ ok: true });
  });
  app.patch("/api/connectors/:name", async (c) => {
    const { disabled } = await c.req.json();
    await connectors.setDisabled(c.req.param("name"), !!disabled);
    return c.json({ ok: true });
  });
  app.post("/api/connectors/:name/reconnect", async (c) => {
    await connectors.reconnect(c.req.param("name"));
    return c.json({ ok: true });
  });
  app.post("/api/connectors/:name/auth", async (c) => c.json({ url: await connectors.beginAuth(c.req.param("name")) }));
  app.post("/api/connectors/:name/signout", async (c) => {
    await connectors.signOut(c.req.param("name"));
    return c.json({ ok: true });
  });
  // Write-only: values go in, only names ever come out.
  app.put("/api/secrets/:name", async (c) => {
    const { value } = await c.req.json();
    connectors.setSecret(c.req.param("name"), String(value ?? ""));
    return c.json({ ok: true });
  });
  app.delete("/api/secrets/:name", (c) => {
    connectors.deleteSecret(c.req.param("name"));
    return c.json({ ok: true });
  });

  // ----- channels -----
  app.get("/api/channels/telegram", (c) => c.json(telegram?.status() ?? { configured: false, bot: null, paired: null, pairUrl: null, error: null }));
  // Write-only like secrets: the token goes in, only the bot's name comes out.
  app.put("/api/channels/telegram", async (c) => {
    if (!telegram) return c.json({ error: "channels are off" }, 404);
    const { token } = await c.req.json();
    return c.json(await telegram.setup(String(token ?? "")));
  });
  app.post("/api/channels/telegram/unpair", (c) => {
    telegram?.unpair();
    return c.json({ ok: true });
  });
  app.delete("/api/channels/telegram", async (c) => {
    await telegram?.remove();
    return c.json({ ok: true });
  });

  // OAuth redirect target (RFC 8252 loopback). Outside /api: the provider's redirect carries no Bits token,
  // so the single-use `state` we generated is what authenticates it.
  app.get("/oauth/callback", async (c) => {
    const { state, code, error, error_description } = c.req.query();
    let ok = false;
    let message: string;
    if (error) message = `The provider said: ${error_description || error}`;
    else if (!state || !code) message = "This page is missing its sign-in code.";
    else {
      try {
        const name = await connectors.finishAuth(state, code);
        ok = true;
        message = `${name} is connected. You can close this tab.`;
      } catch (e: any) {
        message = String(e?.message ?? e);
      }
    }
    return c.html(oauthPage(ok, message), ok ? 200 : 400, { "cache-control": "no-store", "referrer-policy": "no-referrer" });
  });

  // ----- voice -----
  app.get("/api/voice/config", (c) => c.json({ stt: config.voice.stt, tts: config.voice.tts } satisfies VoiceConfig));
  app.post("/api/voice/transcribe", async (c) => {
    const form = await c.req.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) return c.json({ error: "missing audio" }, 400);
    const text = await speechToText(new Uint8Array(await file.arrayBuffer()), file.type || "audio/webm");
    return c.json({ text });
  });
  app.post("/api/voice/speak", async (c) => {
    const { text } = await c.req.json();
    if (!text || typeof text !== "string") return c.json({ error: "missing text" }, 400);
    const { audio, mediaType } = await textToSpeech(text.slice(0, 2000));
    return new Response(audio as BodyInit, { headers: { "content-type": mediaType, "cache-control": "no-store" } });
  });

  // ----- web app (built SPA) -----
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
    const dist = config.webDist;
    const rel = path.normalize(decodeURIComponent(c.req.path)).replace(/^(\.\.[/\\])+/, "");
    let file = path.join(dist, rel);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
    if (!fs.existsSync(file)) {
      return c.html(
        `<p style="font-family:system-ui;padding:2rem">Bits daemon is running. Build the web app with <code>pnpm --filter @bits/web build</code>, or run <code>pnpm dev</code> and open <a href="http://localhost:5180">localhost:5180</a>.</p>`,
      );
    }
    const type = MIME[path.extname(file)] ?? "application/octet-stream";
    const immutable = file.includes(`${path.sep}assets${path.sep}`);
    return new Response(fs.readFileSync(file), {
      headers: { "content-type": type, "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
    });
  });

  return app;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function oauthPage(ok: boolean, message: string) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bits · ${ok ? "Connected" : "Sign-in failed"}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f7f6f3;color:#1d1b26}@media(prefers-color-scheme:dark){body{background:#15141a;color:#ecebf2}}main{max-width:420px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}</style>
<main><h1>${ok ? "Connected" : "Sign-in didn’t finish"}</h1><p>${escapeHtml(message)}</p></main>${ok ? "<script>setTimeout(()=>window.close(),1500)</script>" : ""}`;
}
