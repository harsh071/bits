import { serve } from "@hono/node-server";
import { config } from "./config.ts";
import { openDb } from "./db.ts";
import * as memory from "./memory.ts";
import { Store } from "./store.ts";
import { Runtime } from "./agent/runtime.ts";
import { Scheduler } from "./scheduler.ts";
import { connectors } from "./connectors.ts";
import { createApp } from "./server.ts";
import { Artifacts } from "./artifacts.ts";
import { Telegram } from "./channels/telegram.ts";

// Bits daemon: the always-on part. Clients (web, desktop overlay, phone, channels) are thin views
// over the same conversations; the daemon runs the agent, routines and memory.

async function main() {
  memory.initHome();
  const db = openDb(config.paths.db);
  const store = new Store(db);
  memory.reindex(db);

  const artifacts = new Artifacts();
  const runtime = new Runtime(store, artifacts);
  const scheduler = new Scheduler(store, runtime);
  runtime.nextRoutineInMs = () => scheduler.msUntilNext();

  const stopWatching = memory.watchHome(() => memory.reindex(db));
  runtime.extraTools = () => connectors.tools();
  void connectors.load(); // slow or offline servers shouldn't hold up startup
  runtime.start();
  scheduler.start();
  const telegram = new Telegram(runtime);
  void telegram.start();

  const app = createApp(store, runtime, scheduler, artifacts, telegram);
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`[bits] awake at http://${config.host}:${info.port}  ·  model ${config.model}  ·  home ${config.home}`);
  });

  const shutdown = async () => {
    console.log("[bits] going to sleep…");
    scheduler.stop();
    await telegram.stop();
    runtime.stop();
    stopWatching();
    await connectors.close();
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[bits] failed to start:", err);
  process.exit(1);
});
