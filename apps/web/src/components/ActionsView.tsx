import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Globe, Menu, MessageSquareWarning, MousePointerClick, PanelTop, Send, ShieldCheck, ShieldX, Timer, X } from "lucide-react";
import type { ActionLogDay, ActionLogEntry } from "@bits/protocol";
import { api } from "../api";
import { IconButton } from "./IconButton";
import { Mascot } from "./Mascot";

type Entry = ActionLogDay["entries"][number];
type Step = Extract<ActionLogEntry, { kind: "step" }>;
type Effect = Extract<ActionLogEntry, { kind: "effect" }>;

interface Act {
  id: string;
  start?: Extract<ActionLogEntry, { kind: "act" }>;
  end?: Extract<ActionLogEntry, { kind: "act.end" }>;
  steps: Step[];
  effects: Effect[];
}

/** Group the flat log into one card per act, in time order. */
function groupActs(entries: Entry[]): Act[] {
  const byId = new Map<string, Act>();
  for (const e of entries) {
    let a = byId.get(e.act);
    if (!a) byId.set(e.act, (a = { id: e.act, steps: [], effects: [] }));
    if (e.kind === "act") a.start = e;
    else if (e.kind === "act.end") a.end = e;
    else if (e.kind === "step") a.steps.push(e);
    else a.effects.push(e);
  }
  return [...byId.values()];
}

const host = (url?: string) => (url ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const site = (url?: string) => host(url).split("/")[0] ?? "";
const clock = (at?: string) => (at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "");
const today = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const dayLabel = (d: string) =>
  d === today() ? "Today" : new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

const VERB: Record<string, string> = {
  click: "Clicked",
  type: "Typed into",
  press: "Pressed",
  select: "Chose in",
  hover: "Hovered",
  scroll: "Scrolled",
  navigate: "Opened",
  back: "Went back",
  wait: "Waited",
  dialog: "Answered dialog",
};

function StepRow({ s, effects }: { s: Step; effects: Effect[] }) {
  const target = s.target ? (
    <>
      {" "}
      <span className="text-muted">{s.target.role}</span> <span className="font-medium text-ink">“{s.target.name || "unnamed"}”</span>
    </>
  ) : s.ref !== undefined ? (
    <span className="text-muted"> [{s.ref}]</span>
  ) : null;
  return (
    <li className="relative pl-7">
      <span
        className={`absolute top-[3px] left-0 grid h-[18px] w-[18px] place-items-center rounded-full ${
          s.ok ? "bg-[var(--a-green-soft)] text-[var(--a-green)]" : "bg-[var(--a-rose-soft)] text-[var(--a-rose)]"
        }`}
      >
        {s.ok ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
      </span>
      <div className="flex items-baseline gap-2 text-[13.5px] text-ink-2">
        <span className="min-w-0 flex-1">
          {VERB[s.action] ?? s.action}
          {target}
          {s.text !== undefined && <span className="text-muted"> ← “{s.text}”</span>}
          {s.value !== undefined && s.action !== "navigate" && <span className="text-muted"> {s.value}</span>}
          {s.action === "navigate" && s.value && <span className="text-muted"> {host(s.value)}</span>}
        </span>
        <span className="flex-none font-mono text-[11px] text-faint">{s.ms}ms</span>
      </div>
      {s.error && <div className="mt-0.5 text-[12.5px] text-[var(--a-rose)]">{s.error}</div>}
      {effects.length > 0 && (
        <ul className="mt-1.5 mb-1 flex flex-col gap-1">
          {effects.map((e, i) => (
            <EffectRow key={i} e={e} />
          ))}
        </ul>
      )}
    </li>
  );
}

function EffectRow({ e }: { e: Effect }) {
  if (e.type === "write") {
    const tone =
      e.outcome === "blocked"
        ? { cls: "bg-[var(--a-rose-soft)] text-[var(--a-rose)]", icon: <ShieldX size={13} />, label: "Blocked" }
        : e.outcome === "allowed"
          ? { cls: "bg-[var(--a-amber-soft)] text-[var(--a-amber)]", icon: <ShieldCheck size={13} />, label: "Held, then sent" }
          : { cls: "bg-surface-2 text-muted", icon: <Send size={12} />, label: "Sent" };
    return (
      <li className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ${tone.cls}`}>
        <span className="flex items-center gap-1 font-semibold">
          {tone.icon}
          {tone.label}
        </span>
        <span className="font-mono text-[11.5px] text-ink-2">
          {e.method} {host(e.url)}
        </span>
        {e.by && (
          <span className="text-ink-2">
            · by {e.by}
            {e.reason ? `: ${e.reason}` : ""}
          </span>
        )}
        {e.late && <span className="text-muted">· after the steps</span>}
      </li>
    );
  }
  const icon =
    e.type === "navigate" ? <ArrowRight size={12} /> : e.type === "new-tab" ? <PanelTop size={12} /> : e.type === "dialog" ? <MessageSquareWarning size={12} /> : <Timer size={12} />;
  const text =
    e.type === "navigate"
      ? e.url?.startsWith("chrome-error:")
        ? "Page showed an error"
        : `Went to ${host(e.url)}`
      : e.type === "new-tab"
        ? `Opened a new tab${e.url ? ` (${host(e.url)})` : ""}`
        : e.type === "dialog"
          ? `Page asked: ${e.detail ?? ""}`
          : "Page was still busy when Bits moved on";
  return (
    <li className="flex items-center gap-1.5 px-1 text-[12.5px] text-muted">
      {icon}
      <span className="min-w-0 truncate">{text}</span>
    </li>
  );
}

function ActCard({ a }: { a: Act }) {
  const writes = a.effects.filter((e) => e.type === "write");
  const blocked = writes.filter((e) => e.outcome === "blocked").length;
  const sent = writes.length - blocked;
  const effectsFor = (i: number) => a.effects.filter((e) => e.step === i);
  const stopped = a.end ? !a.end.ok : a.steps.some((s) => !s.ok);
  return (
    <motion.article
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
      className="rounded-[20px] border border-line bg-surface p-4 shadow-soft sm:p-5"
    >
      <header className="mb-3 flex items-start gap-3">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-accent-soft text-accent-ink">
          <Globe size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{a.start?.task ?? "Browser action"}</h2>
          <p className="truncate text-[12.5px] text-muted">
            {site(a.start?.url ?? a.steps[0]?.url)} · {clock(a.start?.at ?? a.steps[0]?.at)}
            {a.end && ` · ${(a.end.ms / 1000).toFixed(1)}s`}
          </p>
        </div>
        <div className="flex flex-none flex-wrap justify-end gap-1.5 text-[11.5px] font-semibold">
          {blocked > 0 && <span className="rounded-full bg-[var(--a-rose-soft)] px-2 py-0.5 text-[var(--a-rose)]">{blocked} blocked</span>}
          {sent > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-2">{sent} sent</span>}
          <span
            className={`rounded-full px-2 py-0.5 ${stopped ? "bg-[var(--a-amber-soft)] text-[var(--a-amber)]" : "bg-[var(--a-green-soft)] text-[var(--a-green)]"}`}
          >
            {a.end ? (stopped ? "Stopped" : "Done") : "Running"}
          </span>
        </div>
      </header>
      <ol className="flex flex-col gap-2">
        {a.steps.map((s) => (
          <StepRow key={s.step} s={s} effects={effectsFor(s.step)} />
        ))}
      </ol>
      {a.end?.error && !a.steps.some((s) => s.error) && <p className="mt-2 text-[12.5px] text-[var(--a-amber)]">{a.end.error}</p>}
    </motion.article>
  );
}

export function ActionsView({ onMenu }: { onMenu: () => void }) {
  const [data, setData] = useState<ActionLogDay | null>(null);
  const [date, setDate] = useState<string | undefined>(undefined);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.actions(date));
      setError(false);
    } catch {
      setError(true);
    }
  }, [date]);

  useEffect(() => {
    void load();
    // The log grows while Bits works; refresh while you're looking at the latest day.
    const live = !date || date === today();
    if (!live) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [load, date]);

  const acts = useMemo(() => (data ? groupActs(data.entries).reverse() : []), [data]);
  const totals = useMemo(() => {
    const writes = data?.entries.filter((e) => e.kind === "effect" && e.type === "write") ?? [];
    const blocked = writes.filter((e) => e.kind === "effect" && e.outcome === "blocked").length;
    return { acts: acts.length, sent: writes.length - blocked, blocked };
  }, [data, acts]);

  const days = data?.days ?? [];
  const idx = data ? days.indexOf(data.date) : -1;
  const go = (d?: string) => d && setDate(d);

  return (
    <div className="scroll-thin h-full flex-1 overflow-y-auto overflow-x-hidden">
      <div className="drag traffic-pad flex h-12 items-center px-3 pt-3">
        <IconButton label="Open menu" onClick={onMenu} className="md:hidden">
          <Menu size={18} />
        </IconButton>
      </div>
      <div className="mx-auto w-full max-w-[880px] px-4 pt-2 pb-16 sm:px-6 sm:pt-6">
        <div className="mb-6 flex items-end gap-4">
          <Mascot state="idle" size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-[36px] leading-none tracking-[-0.015em] text-ink sm:text-[42px]">Browser activity</h1>
            <p className="mt-2 text-[13.5px] text-muted">Every step Bits took in its browser, and what each step sent. Only Bits’ actions, never your own browsing.</p>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-1 shadow-soft">
            <IconButton label="Earlier day" size="sm" onClick={() => go(days[idx - 1])} disabled={idx <= 0}>
              <ChevronLeft size={16} />
            </IconButton>
            <span className="min-w-[110px] text-center text-[13.5px] font-medium text-ink">{data ? dayLabel(data.date) : "…"}</span>
            <IconButton label="Later day" size="sm" onClick={() => go(days[idx + 1])} disabled={idx < 0 || idx >= days.length - 1}>
              <ChevronRight size={16} />
            </IconButton>
          </div>
          {data && acts.length > 0 && (
            <p className="text-[13px] text-muted">
              {totals.acts} {totals.acts === 1 ? "action" : "actions"} · {totals.sent} sent ·{" "}
              <span className={totals.blocked ? "font-semibold text-[var(--a-rose)]" : ""}>{totals.blocked} blocked</span>
            </p>
          )}
        </div>

        {error && !data && (
          <div className="rounded-[18px] border border-line bg-surface p-5 text-[14px] text-muted">Couldn’t reach Bits to load the log. It’ll refresh once the connection is back.</div>
        )}

        {data && acts.length === 0 && (
          <div className="rounded-[20px] border border-dashed border-line-2 bg-surface p-8 text-center">
            <MousePointerClick className="mx-auto mb-3 text-faint" size={28} />
            <p className="text-[14.5px] font-medium text-ink">Nothing yet{data.date === today() ? " today" : ""}</p>
            <p className="mt-1 text-[13px] text-muted">
              When Bits uses its browser, each step shows up here. Try it now with{" "}
              <code className="font-mono text-[12px]">pnpm --filter @bits/computer try</code>.
            </p>
          </div>
        )}

        {acts.length > 0 && (
          <motion.div key={data?.date} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }} className="flex flex-col gap-3">
            {acts.map((a) => (
              <ActCard key={a.id} a={a} />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
