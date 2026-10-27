import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "bits-presets-"));
process.env.BITS_HOME = home;
process.env.BITS_MODEL = "mock:main";

const memory = await import("../src/memory.ts");
const { openDb } = await import("../src/db.ts");
const { Store } = await import("../src/store.ts");
const { Scheduler } = await import("../src/scheduler.ts");
const { morningBriefSchedule, saveMorningBrief, MORNING_BRIEF } = await import("../src/presets.ts");

memory.initHome();
const db = openDb(path.join(home, "state.db"));
const store = new Store(db);
const started: string[] = [];
const scheduler = new Scheduler(store, { startRoutine: (name: string) => (started.push(name), "turn") } as any);

after(() => {
  db.close();
  fs.rmSync(home, { recursive: true, force: true });
});

const brief = () => memory.listRoutineFiles().find((r) => r.name === "morning-brief")!;

test("time and days become a cron schedule", () => {
  assert.equal(morningBriefSchedule("07:30", "weekdays"), "30 7 * * 1-5");
  assert.equal(morningBriefSchedule("6:05", "daily"), "5 6 * * *");
  assert.throws(() => morningBriefSchedule("25:00", "daily"), /07:30/);
  assert.throws(() => morningBriefSchedule("07:30", "sometimes" as any), /weekdays/);
});

test("a new home has the brief, switched off", () => {
  assert.equal(brief().enabled, false);
  assert.equal(brief().prompt, MORNING_BRIEF.prompt.trim());
});

test("re-adding the preset reschedules but keeps an edited prompt", () => {
  memory.saveRoutine({ ...brief(), prompt: memory.OLD_MORNING_BRIEF_PROMPT });
  saveMorningBrief("07:30", "weekdays");
  assert.equal(brief().prompt, MORNING_BRIEF.prompt.trim(), "the old sample prompt is upgraded");
  assert.equal(brief().enabled, true);

  memory.saveRoutine({ ...brief(), prompt: "Just the weather, please.", enabled: false });
  saveMorningBrief("08:00", "daily");
  assert.equal(brief().schedule, "0 8 * * *");
  assert.equal(brief().prompt, "Just the weather, please.");
  assert.equal(brief().enabled, true);
});

test("the scheduler re-plans when a routine's schedule changes", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m).getTime(); // a Wednesday
  saveMorningBrief("09:00", "daily");
  db.prepare("DELETE FROM routine_state").run();
  scheduler.tick(at(6));
  const planned = () => (db.prepare("SELECT next_run_at FROM routine_state WHERE name = 'morning-brief'").get() as any).next_run_at;
  assert.equal(planned(), at(9));

  saveMorningBrief("07:15", "weekdays");
  scheduler.tick(at(6, 30));
  assert.equal(planned(), at(7, 15), "moved earlier, not stuck on the old 9:00");

  scheduler.tick(at(7, 16));
  assert.deepEqual(started, ["morning-brief"]);
});
