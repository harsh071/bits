import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlarmClock, BookText, Check, Menu, NotebookPen, Play, Sparkles, UserRound, X } from "lucide-react";
import { useMemory } from "../store/memory";
import { api } from "../api";
import { humanCron, relTime } from "../lib/text";
import { Markdown } from "./Markdown";
import { IconButton } from "./IconButton";
import { Mascot } from "./Mascot";

export function Section({ icon, title, hint, children, action }: { icon: ReactNode; title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <motion.section
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      className="rounded-[22px] border border-line bg-surface p-4 shadow-soft sm:p-5"
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-accent-soft text-accent-ink">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {hint && <p className="text-[12.5px] text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${checked ? "bg-accent" : "bg-line-2"}`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 600, damping: 32 }}
        className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm ${checked ? "right-[3px]" : "left-[3px]"}`}
      />
    </button>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(20,16,35,0.28)] backdrop-blur-[3px] sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ y: 30, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 30, opacity: 0, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-[680px] flex-col overflow-hidden rounded-t-[24px] border border-line bg-surface shadow-lift sm:rounded-[24px]"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1 truncate font-semibold text-ink">{title}</div>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
      </motion.div>
    </motion.div>
  );
}

function ProfileEditor({ value }: { value: string }) {
  const save = useMemory((s) => s.saveProfile);
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [base, setBase] = useState(value);
  // Pick up remote changes unless the user is mid-edit.
  if (value !== base) {
    setBase(value);
    if (draft === base) setDraft(value);
  }
  const dirty = draft !== value;
  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setState("idle");
        }}
        spellCheck
        aria-label="Profile"
        placeholder="Nothing yet. Tell Bits about yourself here, or just chat — it learns as you go."
        className="scroll-thin min-h-[220px] w-full resize-y rounded-[14px] border border-line bg-surface-2 p-3.5 font-mono text-[13px] leading-relaxed text-ink outline-none transition-colors focus:border-accent/50 focus:bg-surface"
      />
      <div className="mt-2 flex items-center justify-end gap-3">
        {state === "saved" && !dirty && (
          <span className="flex items-center gap-1 text-[12.5px] text-[var(--a-green)]">
            <Check size={14} /> Saved
          </span>
        )}
        {state === "error" && <span className="text-[12.5px] text-danger">Couldn’t save. Try again?</span>}
        {dirty && (
          <button type="button" onClick={() => setDraft(value)} className="text-[13px] text-muted hover:text-ink">
            Revert
          </button>
        )}
        <button
          type="button"
          disabled={!dirty || state === "saving"}
          onClick={async () => {
            setState("saving");
            try {
              await save(draft);
              setState("saved");
            } catch {
              setState("error");
            }
          }}
          className="rounded-full bg-ink px-4 py-1.5 text-[13.5px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-35"
        >
          {state === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export function MemoryView({ onMenu }: { onMenu: () => void }) {
  const { data, loading, error, load, toggleRoutine, runRoutine } = useMemory();
  const [doc, setDoc] = useState<{ title: string; content: string | null } | null>(null);
  const [ran, setRan] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (title: string, fetcher: () => Promise<string>) => {
    setDoc({ title, content: null });
    try {
      const content = await fetcher();
      setDoc({ title, content });
    } catch (e) {
      setDoc({ title, content: `_Couldn’t load this: ${(e as Error).message}_` });
    }
  };

  return (
    <div className="scroll-thin h-full flex-1 overflow-y-auto overflow-x-hidden">
      <div className="drag traffic-pad flex h-12 items-center px-3 pt-3">
        <IconButton label="Open menu" onClick={onMenu} className="md:hidden">
          <Menu size={18} />
        </IconButton>
      </div>
      <div className="mx-auto w-full max-w-[880px] px-4 pt-2 pb-16 sm:px-6 sm:pt-6">
        <div className="mb-8 flex items-end gap-4">
          <Mascot state={loading ? "thinking" : "idle"} size={56} />
          <div className="min-w-0">
            <h1 className="font-serif text-[36px] leading-none tracking-[-0.015em] text-ink sm:text-[42px]">What Bits knows</h1>
            <p className="mt-2 truncate text-[13.5px] text-muted">
              Everything lives in plain files{data?.home ? <> at <code className="font-mono text-[12.5px]">{data.home}</code></> : ""}. You’re in control.
            </p>
          </div>
        </div>

        {error && !data && (
          <div className="rounded-[18px] border border-line bg-surface p-5 text-[14px] text-muted">
            Couldn’t reach Bits to load memory. It’ll refresh once the connection is back.
          </div>
        )}

        {data && (
          <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }} className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
              <Section icon={<UserRound size={16} />} title="About you" hint="profile.md — what Bits keeps in mind every conversation">
                <ProfileEditor value={data.profile} />
              </Section>
              <Section icon={<AlarmClock size={16} />} title="Routines" hint="Things Bits does on its own schedule">
                {data.routines.length === 0 ? (
                  <p className="text-[13.5px] text-muted">No routines yet. Try “Every weekday at 8am, give me a morning brief.”</p>
                ) : (
                  <ul className="flex flex-col">
                    {data.routines.map((r, i) => (
                      <li key={r.name} className={`flex items-start gap-3 py-3 ${i ? "border-t border-line" : "pt-0"}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className={`font-medium ${r.enabled ? "text-ink" : "text-muted"}`}>{r.name}</span>
                            <span className="text-[12.5px] text-muted">{humanCron(r.schedule)}</span>
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">{r.prompt}</div>
                          <div className="mt-1 text-[12px] text-faint">
                            {r.enabled && r.nextRunAt ? `Next ${relTime(r.nextRunAt)}` : r.enabled ? "Not scheduled" : "Paused"}
                            {r.lastRunAt ? ` · last ran ${relTime(r.lastRunAt)}` : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            setRan(r.name);
                            try {
                              await runRoutine(r.name);
                            } catch {
                              /* ignore */
                            }
                            setTimeout(() => setRan((x) => (x === r.name ? null : x)), 1800);
                          }}
                          aria-label={`Run ${r.name} now`}
                          className="flex flex-none items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-accent/40 hover:text-accent-ink"
                        >
                          {ran === r.name ? <Check size={12} /> : <Play size={11} fill="currentColor" />}
                          {ran === r.name ? "Started" : "Run now"}
                        </button>
                        <div className="pt-0.5">
                          <Switch checked={r.enabled} label={`${r.enabled ? "Pause" : "Enable"} ${r.name}`} onChange={(v) => void toggleRoutine(r.name, v).catch(() => {})} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
              <Section icon={<Sparkles size={16} />} title="Skills" hint="Know-how Bits has written down">
                {data.skills.length === 0 ? (
                  <p className="text-[13.5px] text-muted">No skills yet. Bits writes these as it learns how you like things done.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {data.skills.map((s) => (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => open(s.name, async () => (await api.skill(s.name)).content)}
                        className="rounded-[12px] border border-line px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-surface-2"
                      >
                        <div className="text-[13.5px] font-medium text-ink">{s.name}</div>
                        {s.description && <div className="line-clamp-2 text-[12.5px] text-muted">{s.description}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </Section>
              <Section icon={<NotebookPen size={16} />} title="Journal" hint="Monthly logs of what happened">
                {data.logs.length === 0 ? (
                  <p className="text-[13.5px] text-muted">Nothing logged yet.</p>
                ) : (
                  <div className="flex flex-col">
                    {data.logs.map((l) => {
                      const [y, m] = l.month.split("-").map(Number);
                      const label = y && m ? new Date(y, m - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" }) : l.month;
                      return (
                        <button
                          key={l.month}
                          type="button"
                          onClick={() => open(label, async () => (await api.log(l.month)).content)}
                          className="flex items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-surface-2"
                        >
                          <BookText size={15} className="text-muted" />
                          <span className="flex-1 text-[13.5px] text-ink">{label}</span>
                          <span className="text-[12px] tabular-nums text-faint">{l.lines} entries</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Section>
            </div>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {doc && (
          <Sheet title={doc.title} onClose={() => setDoc(null)}>
            {doc.content === null ? <div className="shimmer py-6 text-center text-[13.5px]">Opening…</div> : <Markdown text={doc.content} />}
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  );
}
