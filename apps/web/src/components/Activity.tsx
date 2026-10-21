import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import type { ToolCall } from "../lib/blocks";
import { needsApproval } from "../lib/blocks";
import { toolMeta } from "../lib/tools";

function Json({ label, value }: { label: string; value: unknown }) {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text && text.length > 6000) text = `${text.slice(0, 6000)}\n… (${text.length - 6000} more characters)`;
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{label}</div>
      <pre className="scroll-thin max-h-56 overflow-auto rounded-lg bg-surface-2 p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-ink-2">
        {text || "—"}
      </pre>
    </div>
  );
}

export function ActivityChip({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const meta = toolMeta(call);
  const Icon = meta.icon;
  const awaiting = call.result && needsApproval(call.result.output);
  const running = !call.result;
  const error = call.result?.isError;
  return (
    <div className="min-w-0 max-w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface py-1 pr-2.5 pl-1.5 text-[13px] text-ink-2 shadow-soft transition-colors hover:border-line-2 hover:text-ink"
      >
        <span className="relative grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-surface-2 text-muted group-hover:text-accent-ink">
          {running ? <LoaderCircle size={13} className="animate-spin text-accent" /> : <Icon size={13} strokeWidth={2.1} />}
          {(error || awaiting) && (
            <span
              className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-surface ${error ? "bg-danger" : "bg-[var(--a-amber)]"}`}
            />
          )}
        </span>
        <span className={`flex-none font-medium ${running ? "shimmer" : ""}`}>{meta.label}</span>
        {meta.detail && <span className="min-w-0 truncate text-muted">{meta.detail}</span>}
        <ChevronDown size={13} className={`flex-none text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 grid gap-2 rounded-xl border border-line bg-surface p-2.5 sm:grid-cols-2">
              <Json label={`${call.name} · input`} value={call.input} />
              <Json label={error ? "error" : "output"} value={call.result ? call.result.output : "Running…"} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A run of tool calls. While the turn is live they stay visible; afterwards they fold into one row. */
export function ToolRun({ steps, live }: { steps: ToolCall[][]; live?: boolean }) {
  const calls = steps.flat();
  const [open, setOpen] = useState(false);
  const collapsible = !live && calls.length > 1;

  if (!collapsible) {
    return (
      <div className="flex flex-col gap-1.5">
        {steps.map((step, i) => (
          <div key={i} className="flex flex-wrap gap-1.5">
            {step.map((c) => (
              <ActivityChip key={c.id} call={c} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const icons = [...new Map(calls.map((c) => [toolMeta(c).icon, c])).keys()].slice(0, 4);
  const errors = calls.filter((c) => c.result?.isError).length;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group inline-flex items-center gap-2 rounded-full py-1 pr-2 pl-1 text-[13px] text-muted transition-colors hover:text-ink"
      >
        <span className="flex -space-x-1">
          {icons.map((Icon, i) => (
            <span key={i} className="grid h-[22px] w-[22px] place-items-center rounded-full border border-line bg-surface text-muted ring-2 ring-bg">
              <Icon size={12} strokeWidth={2.1} />
            </span>
          ))}
        </span>
        <span>
          Worked for {calls.length} steps
          {errors > 0 && <span className="text-danger"> · {errors} failed</span>}
        </span>
        <ChevronDown size={14} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 ml-[11px] flex flex-col gap-1.5 border-l border-line pl-4">
              {steps.map((step, i) => (
                <div key={i} className="flex flex-wrap gap-1.5">
                  {step.map((c) => (
                    <ActivityChip key={c.id} call={c} />
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
