import * as memory from "./memory.ts";

// One-click routines. Each is an ordinary routine file afterwards: the user (or Bits) can edit its prompt,
// pause it or delete it like any other. Re-adding a preset only changes its schedule, so edits survive.

export type Days = "weekdays" | "daily";

export const MORNING_BRIEF = { name: "morning-brief", description: "Morning brief", prompt: memory.MORNING_BRIEF_PROMPT };

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function morningBriefSchedule(time: string, days: Days) {
  const m = TIME.exec(time);
  if (!m) throw new Error("Time must look like 07:30");
  if (days !== "weekdays" && days !== "daily") throw new Error("days must be weekdays or daily");
  return `${Number(m[2])} ${Number(m[1])} * * ${days === "weekdays" ? "1-5" : "*"}`;
}

export function saveMorningBrief(time: string, days: Days) {
  const schedule = morningBriefSchedule(time, days);
  const existing = memory.listRoutineFiles().find((r) => r.name === MORNING_BRIEF.name);
  memory.saveRoutine({
    name: MORNING_BRIEF.name,
    schedule,
    enabled: true,
    description: existing?.description && existing.description !== "Weekday morning brief" ? existing.description : MORNING_BRIEF.description,
    // Keep a prompt the user (or Bits) wrote; replace the empty or original sample one.
    prompt: existing?.prompt && existing.prompt !== memory.OLD_MORNING_BRIEF_PROMPT ? existing.prompt : MORNING_BRIEF.prompt,
    conversation: existing?.conversation,
  });
  return { name: MORNING_BRIEF.name, schedule };
}
