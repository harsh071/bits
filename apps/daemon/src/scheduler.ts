import { Cron } from "croner";
import * as memory from "./memory.ts";
import type { Store } from "./store.ts";
import type { Runtime } from "./agent/runtime.ts";

// Routines are files (~/.bits/routines/*.md); this table only tracks when each last/next runs.
// The scheduler wakes every 15s, which is plenty for minute-granularity cron schedules.

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private store: Store;
  private runtime: Runtime;
  constructor(store: Store, runtime: Runtime) {
    this.store = store;
    this.runtime = runtime;
  }

  start() {
    this.timer = setInterval(() => this.tick(), 15_000);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private state(name: string) {
    return this.store.db.prepare("SELECT * FROM routine_state WHERE name = ?").get(name) as
      | { name: string; last_run_at: number | null; next_run_at: number | null }
      | undefined;
  }

  overview() {
    return memory.listRoutineFiles().map((r) => {
      const s = this.state(r.name);
      return {
        name: r.name,
        schedule: r.schedule,
        enabled: r.enabled,
        prompt: r.prompt,
        lastRunAt: s?.last_run_at ?? null,
        nextRunAt: r.enabled ? nextRun(r.schedule) : null,
      };
    });
  }

  msUntilNext(): number | null {
    const next = this.overview()
      .map((r) => r.nextRunAt)
      .filter((t): t is number => t !== null)
      .sort((a, b) => a - b)[0];
    return next === undefined ? null : next - Date.now();
  }

  tick(now = Date.now()) {
    for (const r of memory.listRoutineFiles()) {
      const s = this.state(r.name);
      if (!s) {
        // First sighting: schedule from now (don't fire retroactively).
        this.store.db
          .prepare("INSERT INTO routine_state (name, next_run_at) VALUES (?, ?)")
          .run(r.name, nextRun(r.schedule, now));
        continue;
      }
      if (!r.enabled) continue;
      if (s.next_run_at === null) {
        this.store.db.prepare("UPDATE routine_state SET next_run_at = ? WHERE name = ?").run(nextRun(r.schedule, now), r.name);
        continue;
      }
      if (s.next_run_at <= now) {
        try {
          this.runtime.startRoutine(r.name);
        } catch (e) {
          console.error(`[bits] routine ${r.name} failed to start:`, e);
        }
        this.store.db
          .prepare("UPDATE routine_state SET last_run_at = ?, next_run_at = ? WHERE name = ?")
          .run(now, nextRun(r.schedule, now + 1000), r.name);
      }
    }
  }

  runNow(name: string) {
    const turnId = this.runtime.startRoutine(name);
    this.store.db.prepare("UPDATE routine_state SET last_run_at = ? WHERE name = ?").run(Date.now(), name);
    return turnId;
  }
}

function nextRun(schedule: string, from = Date.now()): number | null {
  try {
    return new Cron(schedule).nextRun(new Date(from))?.getTime() ?? null;
  } catch {
    return null;
  }
}
