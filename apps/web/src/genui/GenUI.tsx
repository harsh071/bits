import { Component, createContext, useContext, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Globe, ArrowDownRight, ArrowUpRight, Check, CircleAlert, CircleCheck, ExternalLink, Info, Minus, TriangleAlert } from "lucide-react";
import type { RenderUIInput, UINode } from "@bits/protocol";
import { Markdown } from "../components/Markdown";
import { Chart } from "./Chart";
import { accentVars, iconFor } from "./icons";

/** Buttons in `actions` nodes call this with their message. */
export const GenUIActions = createContext<((message: string) => void) | null>(null);

const MAX_DEPTH = 12;
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const gapCls = (g?: string) => (g === "sm" ? "gap-2" : g === "lg" ? "gap-5" : "gap-3");

const rise = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 26 } },
} as const;
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.055 } } } as const;

function Children({ nodes, depth }: { nodes: unknown; depth: number }) {
  return (
    <>
      {arr<UINode>(nodes).map((n, i) => (
        <motion.div key={i} variants={rise} className={`min-w-0 ${n && (n.type === "badge" || n.type === "actions") ? "!flex-none !basis-auto" : ""}`}>
          <Node node={n} depth={depth + 1} />
        </motion.div>
      ))}
    </>
  );
}

function Node({ node, depth }: { node: UINode; depth: number }): ReactNode {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return null;
  switch (node.type) {
    case "stack":
      return (
        <motion.div variants={stagger} className={`flex flex-col ${gapCls(node.gap)}`}>
          <Children nodes={node.children} depth={depth} />
        </motion.div>
      );
    case "row":
      return (
        <motion.div variants={stagger} className={`flex ${node.wrap === false ? "" : "flex-wrap"} items-start ${gapCls(node.gap)} [&>*]:flex-1 [&>*]:basis-[160px]`}>
          <Children nodes={node.children} depth={depth} />
        </motion.div>
      );
    case "grid": {
      const cols = node.columns === 3 ? "sm:grid-cols-3" : node.columns === 4 ? "grid-cols-2 sm:grid-cols-4" : "sm:grid-cols-2";
      return (
        <motion.div variants={stagger} className={`grid grid-cols-1 gap-3 ${cols} [&>*>*]:h-full`}>
          <Children nodes={node.children} depth={depth} />
        </motion.div>
      );
    }
    case "card":
      return <CardNode node={node} depth={depth} />;
    case "heading": {
      const lvl = node.level ?? 2;
      const cls =
        lvl === 1
          ? "font-serif text-[28px] leading-tight tracking-[-0.01em]"
          : lvl === 2
            ? "text-[17px] font-semibold tracking-[-0.01em]"
            : "text-[14px] font-semibold text-ink-2";
      return <div className={`${cls} text-ink`} role="heading" aria-level={lvl}>{s(node.text)}</div>;
    }
    case "text":
      return <Markdown text={s(node.text)} className={node.tone === "muted" ? "text-muted text-[13.5px]" : "text-ink"} />;
    case "stat":
      return <StatNode node={node} />;
    case "list":
      return <ListNode node={node} />;
    case "table":
      return <TableNode node={node} />;
    case "chart":
      return <Chart kind={node.kind} data={node.data} x={s(node.x)} series={node.series} title={node.title} />;
    case "timeline":
      return (
        <ol className="relative ml-1">
          {arr<{ time: string; title: string; detail?: string; done?: boolean }>(node.items).map((it, i, all) => (
            <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
              {i < all.length - 1 && <span className="absolute left-[5px] top-4 bottom-0 w-px bg-line-2" />}
              <span
                className={`relative mt-[5px] h-[11px] w-[11px] flex-none rounded-full border-2 ${it.done ? "border-accent bg-accent" : "border-line-2 bg-surface"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[12px] font-medium tabular-nums text-muted">{s(it.time)}</span>
                  <span className={`font-medium ${it.done ? "text-muted line-through decoration-faint" : "text-ink"}`}>{s(it.title)}</span>
                </div>
                {it.detail && <div className="mt-0.5 text-[13px] text-muted">{s(it.detail)}</div>}
              </div>
            </li>
          ))}
        </ol>
      );
    case "checklist":
      return <ChecklistNode node={node} />;
    case "image":
      return (
        <figure className="m-0">
          <img src={s(node.src)} alt={s(node.alt)} loading="lazy" className="max-h-[420px] w-full rounded-2xl border border-line object-cover" />
          {node.caption && <figcaption className="mt-1.5 text-center text-[12px] text-muted">{s(node.caption)}</figcaption>}
        </figure>
      );
    case "link":
      return <LinkNode node={node} />;
    case "callout":
      return <CalloutNode node={node} />;
    case "badge": {
      const a = accentVars(node.accent);
      return (
        <span className="inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={{ color: a.fg, background: a.soft }}>
          {s(node.text)}
        </span>
      );
    }
    case "progress": {
      const v = Math.max(0, Math.min(100, Number(node.value) || 0));
      return (
        <div>
          {(
            <div className="mb-1.5 flex justify-between text-[12.5px]">
              <span className="text-ink-2">{s(node.label)}</span>
              <span className="tabular-nums text-muted">{Math.round(v)}%</span>
            </div>
          )}
          <div className="h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line ring-inset">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[var(--a-violet)] to-[#a58bff]"
              initial={{ width: 0 }}
              animate={{ width: `${v}%` }}
              transition={{ type: "spring", stiffness: 90, damping: 20, delay: 0.15 }}
            />
          </div>
        </div>
      );
    }
    case "divider":
      return <hr className="my-1 border-0 border-t border-line" />;
    case "actions":
      return <ActionsNode node={node} />;
    default:
      return <JsonPreview value={node} label={`Unknown block “${s((node as { type?: unknown }).type)}”`} />;
  }
}

function CardNode({ node, depth }: { node: Extract<UINode, { type: "card" }>; depth: number }) {
  const a = accentVars(node.accent);
  const Icon = iconFor(node.icon);
  const hasHeader = node.title || node.subtitle || Icon;
  return (
    <motion.div
      variants={stagger}
      className="relative overflow-hidden rounded-[18px] border border-line bg-surface p-4 shadow-soft"
    >
      {node.accent && <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: a.fg, opacity: 0.85 }} />}
      {hasHeader && (
        <div className={`flex items-start gap-3 ${arr(node.children).length ? "mb-3" : ""}`}>
          {Icon && (
            <span className="grid h-9 w-9 flex-none place-items-center rounded-xl" style={{ background: a.soft, color: a.fg }}>
              <Icon size={18} strokeWidth={2} />
            </span>
          )}
          <div className="min-w-0 pt-0.5">
            {node.title && <div className="font-semibold leading-snug tracking-[-0.01em] text-ink">{s(node.title)}</div>}
            {node.subtitle && <div className="text-[13px] leading-snug text-muted">{s(node.subtitle)}</div>}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <Children nodes={node.children} depth={depth} />
      </div>
    </motion.div>
  );
}

function StatNode({ node }: { node: Extract<UINode, { type: "stat" }> }) {
  const trend = node.trend ?? (s(node.delta).trim().startsWith("-") ? "down" : node.delta ? "up" : undefined);
  const color = trend === "up" ? "var(--a-green)" : trend === "down" ? "var(--a-rose)" : "var(--muted)";
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  return (
    <div className="rounded-[16px] border border-line bg-surface px-4 py-3.5">
      <div className="text-[12.5px] text-muted">{s(node.label)}</div>
      <div className="mt-0.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-ink">{s(node.value)}</div>
      {node.delta && (
        <div className="mt-1 inline-flex items-center gap-0.5 text-[12.5px] font-medium" style={{ color }}>
          <TrendIcon size={14} strokeWidth={2.25} />
          {s(node.delta)}
        </div>
      )}
    </div>
  );
}

function ListNode({ node }: { node: Extract<UINode, { type: "list" }> }) {
  const items = arr<{ title: string; subtitle?: string; meta?: string; icon?: string; href?: string }>(node.items);
  return (
    <ul className="-mx-1 flex flex-col">
      {items.map((it, i) => {
        const Icon = iconFor(it.icon);
        const inner = (
          <>
            {node.ordered ? (
              <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-ink">{i + 1}</span>
            ) : Icon ? (
              <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-surface-2 text-ink-2">
                <Icon size={16} />
              </span>
            ) : (
              <span className="mt-[9px] h-1.5 w-1.5 flex-none rounded-full bg-faint" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium leading-snug text-ink">{s(it.title)}</div>
              {it.subtitle && <div className="text-[13px] leading-snug text-muted">{s(it.subtitle)}</div>}
            </div>
            {it.meta && <div className="flex-none pt-0.5 text-[12.5px] tabular-nums text-muted">{s(it.meta)}</div>}
            {it.href && <ExternalLink size={14} className="mt-1 flex-none text-faint" />}
          </>
        );
        const cls = "flex items-start gap-3 rounded-xl px-1 py-2";
        return (
          <li key={i} className={i ? "border-t border-line" : ""}>
            {it.href ? (
              <a href={s(it.href)} target="_blank" rel="noreferrer noopener" className={`${cls} transition-colors hover:bg-surface-2`}>
                {inner}
              </a>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TableNode({ node }: { node: Extract<UINode, { type: "table" }> }) {
  const cols = arr<string>(node.columns);
  const rows = arr<(string | number)[]>(node.rows);
  const numeric = cols.map((_, c) => rows.length > 0 && rows.every((r) => typeof arr(r)[c] === "number" || /^[-+$€£]?[\d,.]+%?$/.test(s(arr(r)[c]))));
  return (
    <div className="scroll-thin overflow-x-auto rounded-[14px] border border-line bg-surface">
      <table className="w-full border-collapse text-[13.5px]">
        <thead>
          <tr className="bg-surface-2">
            {cols.map((c, i) => (
              <th key={i} className={`whitespace-nowrap border-b border-line px-3.5 py-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted ${numeric[i] ? "text-right" : "text-left"}`}>
                {s(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="even:bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)]">
              {cols.map((_, j) => (
                <td key={j} className={`px-3.5 py-2 align-top text-ink-2 ${j === 0 ? "font-medium text-ink" : ""} ${numeric[j] ? "text-right tabular-nums" : ""}`}>
                  {s(arr(r)[j])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChecklistNode({ node }: { node: Extract<UINode, { type: "checklist" }> }) {
  const items = arr<{ text: string; done?: boolean }>(node.items);
  const [done, setDone] = useState(() => items.map((i) => !!i.done));
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((it, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))}
            className="flex w-full items-start gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface-2"
            aria-pressed={done[i]}
          >
            <span
              className={`mt-[2px] grid h-[18px] w-[18px] flex-none place-items-center rounded-[6px] border transition-colors ${done[i] ? "border-accent bg-accent text-white" : "border-line-2 bg-surface"}`}
            >
              {done[i] && <Check size={12} strokeWidth={3} />}
            </span>
            <span className={done[i] ? "text-muted line-through decoration-faint" : "text-ink"}>{s(it.text)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function LinkNode({ node }: { node: Extract<UINode, { type: "link" }> }) {
  let host = "";
  try {
    host = new URL(s(node.href)).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  return (
    <a
      href={s(node.href)}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex overflow-hidden rounded-[16px] border border-line bg-surface transition-all hover:border-line-2 hover:shadow-float"
    >
      <div className="min-w-0 flex-1 p-3.5">
        <div className="mb-1 flex items-center gap-1.5 text-[12px] text-muted">
          <Globe size={12} className="flex-none" />
          {host}
        </div>
        <div className="line-clamp-2 font-medium leading-snug text-ink group-hover:text-accent-ink">{s(node.title)}</div>
        {node.description && <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{s(node.description)}</div>}
      </div>
      {node.image && <img src={s(node.image)} alt="" loading="lazy" className="w-24 flex-none object-cover sm:w-32" />}
    </a>
  );
}

function CalloutNode({ node }: { node: Extract<UINode, { type: "callout" }> }) {
  const tone = node.tone ?? "info";
  const map = {
    info: { accent: "violet", Icon: Info },
    success: { accent: "green", Icon: CircleCheck },
    warning: { accent: "amber", Icon: TriangleAlert },
    danger: { accent: "rose", Icon: CircleAlert },
  } as const;
  const { accent, Icon } = map[tone] ?? map.info;
  const a = accentVars(accent);
  return (
    <div className="flex gap-3 rounded-[14px] px-3.5 py-3" style={{ background: a.soft }}>
      <Icon size={18} className="mt-[2px] flex-none" style={{ color: a.fg }} />
      <div className="min-w-0 text-[14px]">
        {node.title && <div className="font-semibold text-ink">{s(node.title)}</div>}
        <Markdown text={s(node.text)} className="text-ink-2" />
      </div>
    </div>
  );
}

function ActionsNode({ node }: { node: Extract<UINode, { type: "actions" }> }) {
  const send = useContext(GenUIActions);
  const [sent, setSent] = useState<number | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      {arr<{ label: string; message: string; style?: string }>(node.buttons).map((b, i) => {
        const primary = b.style === "primary" || (i === 0 && b.style !== "secondary");
        return (
          <motion.button
            key={i}
            type="button"
            whileTap={{ scale: 0.96 }}
            disabled={sent !== null || !send}
            onClick={() => {
              setSent(i);
              send?.(s(b.message) || s(b.label));
            }}
            className={`rounded-full px-4 py-2 text-[13.5px] font-medium transition-all disabled:opacity-50 ${
              primary
                ? "bg-ink text-bg shadow-soft hover:opacity-90"
                : "border border-line-2 bg-surface text-ink hover:bg-surface-2"
            } ${sent === i ? "!opacity-100 ring-2 ring-accent/40" : ""}`}
          >
            {s(b.label)}
          </motion.button>
        );
      })}
    </div>
  );
}

export function JsonPreview({ value, label }: { value: unknown; label?: string }) {
  let text = "";
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <div className="rounded-[14px] border border-dashed border-line-2 bg-surface-2 p-3">
      {label && <div className="mb-1.5 text-[12px] font-medium text-muted">{label}</div>}
      <pre className="scroll-thin max-h-64 overflow-auto font-mono text-[11.5px] leading-relaxed text-ink-2">{text}</pre>
    </div>
  );
}

class Boundary extends Component<{ fallback: unknown; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <JsonPreview value={this.props.fallback} label="Couldn’t draw this view — here’s the raw data" />;
    return this.props.children;
  }
}

/** Render a `render_ui` tool input. Never throws. */
export function GenUI({ input, onAction }: { input: RenderUIInput | unknown; onAction?: (message: string) => void }) {
  const i = (input ?? {}) as Partial<RenderUIInput>;
  const node = i.ui;
  return (
    <Boundary fallback={input}>
      <GenUIActions.Provider value={onAction ?? null}>
        <motion.div initial="hidden" animate="show" variants={stagger} className="flex flex-col gap-3">
          {i.title && (
            <motion.div variants={rise} className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-ink">
              {s(i.title)}
            </motion.div>
          )}
          <motion.div variants={rise} className="min-w-0">
            {node && typeof node === "object" ? <Node node={node} depth={0} /> : <JsonPreview value={input} label="Nothing to show" />}
          </motion.div>
        </motion.div>
      </GenUIActions.Provider>
    </Boundary>
  );
}
