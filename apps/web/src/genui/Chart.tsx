import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

type Datum = Record<string, string | number>;

interface Props {
  kind: "bar" | "line" | "area";
  data: Datum[];
  x: string;
  series: string[];
  title?: string;
  height?: number;
}

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const toNum = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.\-eE]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    max = min + 1;
    min = Math.min(0, min);
  }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(1)}k`;
  return `${+n.toFixed(2)}`;
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Chart({ kind, data: rawData, x, series: rawSeries, title, height = 200 }: Props) {
  const gid = useId().replace(/:/g, "");
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const data = Array.isArray(rawData) ? rawData.filter((d) => d && typeof d === "object").slice(0, 200) : [];
  const series = (Array.isArray(rawSeries) ? rawSeries : []).filter((s) => typeof s === "string").slice(0, 5);

  const { ticks, yMin, yMax } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of data) for (const s of series) {
      const v = toNum(d[s]);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
    if (kind === "bar" || lo <= 0 || lo < hi * 0.45) lo = Math.min(0, lo);
    const t = niceTicks(lo, hi);
    return { ticks: t, yMin: t[0], yMax: t[t.length - 1] };
  }, [data, series, kind]);

  const padL = Math.max(28, Math.max(...ticks.map((t) => fmt(t).length)) * 7 + 10);
  const padR = 8;
  const padT = 10;
  const padB = 26;
  const W = Math.max(width, 120);
  const iw = W - padL - padR;
  const ih = height - padT - padB;
  const n = data.length;

  const yPos = (v: number) => padT + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const band = n ? iw / n : iw;
  const xCenter = (i: number) => (kind === "bar" ? padL + band * i + band / 2 : padL + (n <= 1 ? iw / 2 : (iw * i) / (n - 1)));

  const labelEvery = Math.max(1, Math.ceil((n * 56) / Math.max(iw, 1)));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xCenter(i) - px);
      if (d < bestD) [best, bestD] = [i, d];
    }
    setHover(n ? best : null);
  };

  if (!n || !series.length) {
    return <div className="text-[13px] text-muted">No data to chart.</div>;
  }

  const groupW = Math.min(band * 0.72, 18 * series.length + 12);
  const barW = Math.max(3, groupW / series.length - 2);

  const linePath = (s: string) =>
    data.map((d, i) => `${i ? "L" : "M"}${xCenter(i).toFixed(1)},${yPos(toNum(d[s])).toFixed(1)}`).join(" ");

  const tooltipLeft = hover != null ? Math.min(Math.max(xCenter(hover), 70), W - 70) : 0;

  return (
    <div className="w-full">
      {(title || series.length > 1) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {title && <div className="text-[13px] font-medium text-ink-2">{title}</div>}
          {series.length > 1 && (
            <div className="flex flex-wrap gap-3">
              {series.map((s, i) => (
                <span key={s} className="flex items-center gap-1.5 text-[12px] text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i] }} />
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg
            width={W}
            height={height}
            className="block touch-none select-none"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={title ?? `${kind} chart of ${series.join(", ")}`}
          >
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s} id={`${gid}-g${i}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor={COLORS[i]} stopOpacity={0.28} />
                  <stop offset="1" stopColor={COLORS[i]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={yPos(t)} y2={yPos(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={padL - 8} y={yPos(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={i} x={xCenter(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {String(d[x] ?? "").slice(0, 10)}
                </text>
              ) : null,
            )}
            {hover != null && kind !== "bar" && (
              <line x1={xCenter(hover)} x2={xCenter(hover)} y1={padT} y2={padT + ih} stroke="var(--line-2)" />
            )}
            {hover != null && kind === "bar" && (
              <rect x={padL + band * hover} y={padT} width={band} height={ih} fill="var(--accent-soft)" opacity={0.6} rx={6} />
            )}

            {kind === "bar" &&
              data.map((d, i) =>
                series.map((s, j) => {
                  const v = toNum(d[s]);
                  const y0 = yPos(Math.max(0, yMin));
                  const y1 = yPos(v);
                  const h = Math.abs(y0 - y1);
                  const bx = xCenter(i) - groupW / 2 + j * (barW + 2) + 1;
                  return (
                    <motion.rect
                      key={`${i}-${s}`}
                      x={bx}
                      width={barW}
                      rx={Math.min(4, barW / 2)}
                      fill={COLORS[j]}
                      initial={{ y: y0, height: 0 }}
                      animate={{ y: Math.min(y0, y1), height: Math.max(h, 1) }}
                      transition={{ type: "spring", stiffness: 170, damping: 22, delay: Math.min(i * 0.025, 0.4) }}
                    />
                  );
                }),
              )}

            {kind !== "bar" &&
              series.map((s, j) => (
                <g key={s}>
                  {kind === "area" && (
                    <motion.path
                      d={`${linePath(s)} L${xCenter(n - 1)},${yPos(Math.max(0, yMin))} L${xCenter(0)},${yPos(Math.max(0, yMin))} Z`}
                      fill={`url(#${gid}-g${j})`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.2 }}
                    />
                  )}
                  <motion.path
                    d={linePath(s)}
                    fill="none"
                    stroke={COLORS[j]}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                  />
                  {hover != null && (
                    <circle cx={xCenter(hover)} cy={yPos(toNum(data[hover][s]))} r={4} fill="var(--surface)" stroke={COLORS[j]} strokeWidth={2} />
                  )}
                  {n === 1 && <circle cx={xCenter(0)} cy={yPos(toNum(data[0][s]))} r={3} fill={COLORS[j]} />}
                </g>
              ))}
          </svg>
        )}
        {hover != null && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-[110px] -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-[12px] shadow-float"
            style={{ left: tooltipLeft }}
          >
            <div className="mb-1 font-medium text-ink">{String(data[hover][x] ?? "")}</div>
            {series.map((s, j) => (
              <div key={s} className="flex items-center justify-between gap-3 text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: COLORS[j] }} />
                  {s}
                </span>
                <span className="font-medium tabular-nums text-ink">{String(data[hover][s] ?? "—")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
