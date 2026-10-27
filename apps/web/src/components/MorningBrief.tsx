import { useEffect, useState } from "react";
import { Check, Sun } from "lucide-react";
import type { MorningBriefBody } from "@bits/protocol";
import { api } from "../api";
import { useMemory } from "../store/memory";
import { humanCron } from "../lib/text";

const NAME = "morning-brief";
const fieldCls =
  "rounded-[10px] border border-line bg-surface-2 px-2 py-1 text-[13px] text-ink outline-none transition-colors focus:border-accent/50 focus:bg-surface";

/** "30 7 * * 1-5" → { time: "07:30", days: "weekdays" }, or null for a schedule this picker can't show. */
function parse(schedule: string | undefined): MorningBriefBody | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/.exec(schedule?.trim() ?? "");
  if (!m) return null;
  return { time: `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`, days: m[3] === "*" ? "daily" : "weekdays" };
}

/**
 * Pick a time and turn the morning brief on (or move it). The routine itself is an ordinary file
 * (~/.bits/routines/morning-brief.md), so its prompt can still be edited by hand or by asking Bits.
 */
export function MorningBrief({ label }: { label?: string }) {
  const { data, load } = useMemory();
  const routine = data?.routines.find((r) => r.name === NAME);
  const current = parse(routine?.schedule);
  const [time, setTime] = useState(current?.time ?? "07:30");
  const [days, setDays] = useState<MorningBriefBody["days"]>(current?.days ?? "weekdays");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!data) void load();
  }, [data, load]);
  // Follow changes made elsewhere (the other picker, Bits, a hand edit).
  useEffect(() => {
    if (current) {
      setTime(current.time);
      setDays(current.days);
    }
  }, [current?.time, current?.days]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;
  const on = !!routine?.enabled;
  const changed = !current || current.time !== time || current.days !== days;
  const custom = routine && !current; // a schedule like "every 2 hours": don't offer to overwrite it silently

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.addMorningBrief({ time, days });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {label && (
          <span className="mr-1 flex items-center gap-1.5 text-[13.5px] text-ink-2">
            <Sun size={14} className="text-accent-ink" /> {label}
          </span>
        )}
        <input type="time" aria-label="Brief time" className={fieldCls} value={time} onChange={(e) => setTime(e.target.value)} />
        <select aria-label="Brief days" className={fieldCls} value={days} onChange={(e) => setDays(e.target.value as MorningBriefBody["days"])}>
          <option value="weekdays">Weekdays</option>
          <option value="daily">Every day</option>
        </select>
        {on && !changed ? (
          <span className="flex items-center gap-1 text-[12.5px] text-[var(--a-green)]">
            <Check size={12} /> On
          </span>
        ) : (
          <button
            type="button"
            disabled={busy || !time}
            onClick={() => void save()}
            className="rounded-full bg-ink px-3 py-1 text-[12.5px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-35"
          >
            {busy ? "Saving…" : on ? "Update" : "Turn on"}
          </button>
        )}
      </div>
      {custom && <span className="text-[12px] text-muted">Now: {humanCron(routine.schedule)}. Picking a time replaces it.</span>}
      {err && <span className="text-[12px] text-danger">{err}</span>}
    </div>
  );
}
