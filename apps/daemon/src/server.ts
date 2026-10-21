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
import { connectorStatus } from "./connectors.ts";
import { speechToText, textToSpeech } from "./voice.ts";

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

export function createApp(store: Store, runtime: Runtime, scheduler: Scheduler) {
  const app = new Hono();

  app.onError((err, c) => {
    console.error("[bits] request failed:", err);
    return c.json({ error: String(err.message ?? err) }, 400);
  });

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

  app.get("/api/status", (c) => c.json({ model: config.model, fastModel: config.fastModel, voice: config.voice, connectors: connectorStatus }));

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
        `<p style="font-family:system-ui;padding:2rem">Bits daemon is running. Build the web app with <code>pnpm --filter @bits/web build</code>, or run <code>pnpm dev</code> and open <a href="http://localhost:5173">localhost:5173</a>.</p>`,
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
