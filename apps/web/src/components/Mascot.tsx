import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useMascotStyle, type MascotStyle } from "../store/mascot";

export type MascotState = "idle" | "thinking" | "working" | "listening" | "speaking" | "waiting" | "offline";

// ---------- shared clock ----------
// Every animated mascot reads one 10 fps frame counter. Frame steps suit the digital look and stay cheap.

let frame = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();

function subscribe(fn: () => void) {
  subs.add(fn);
  timer ??= setInterval(() => {
    frame++;
    subs.forEach((s) => s());
  }, 100);
  return () => {
    subs.delete(fn);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
const noSubscribe = () => () => {};

function useFrame(active: boolean) {
  return useSyncExternalStore(active ? subscribe : noSubscribe, () => (active ? frame : 0), () => 0);
}

// ---------- colors ----------

const ACCENT = "#7C5CFF";
const AMBER = "#D4900F";

function mix(a: string, b: string, p: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (x: number, s: number) => (x >> s) & 255;
  return `#${[16, 8, 0].map((s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * p).toString(16).padStart(2, "0")).join("")}`;
}
const SLEEPY = mix(ACCENT, "#A8A4B4", 0.7);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** A believable voice level when no real audio is wired in (ms clock). */
const fakeLevel = (ms: number) => clamp01(Math.abs(Math.sin(ms / 130) * 0.65 + Math.sin(ms / 420) * 0.35));

// ---------- component ----------

interface Props {
  state?: MascotState;
  size?: number;
  /** Live audio level 0..1, polled every frame while listening/speaking. */
  level?: () => number;
  className?: string;
  title?: string;
  /** Force a style instead of the user's choice (previews, the style picker). */
  variant?: MascotStyle;
  /** Render a single still frame (e.g. next to every past message). */
  still?: boolean;
}

export function Mascot({ state = "idle", size = 40, level, className, title, variant, still }: Props) {
  const reduce = useReducedMotion();
  const preferred = useMascotStyle((s) => s.style);
  const style = variant ?? preferred;
  const animated = !reduce && !still;
  const t = useFrame(animated);
  // Offset each mascot's clock so they don't all blink in unison.
  const [phase] = useState(() => Math.floor(Math.random() * 37));
  const f = animated ? t + phase : 5;

  // Voice level: real audio when given, otherwise a simulated one.
  const voice = state === "listening" || state === "speaking";
  const raw = useMotionValue(0);
  const smooth = useSpring(raw, { stiffness: 300, damping: 22, mass: 0.6 });
  const audioScale = useTransform(smooth, [0, 1], [1, 1.16]);
  useEffect(() => {
    if (!voice || !animated) {
      raw.set(0);
      return;
    }
    let id = 0;
    const tick = () => {
      raw.set(clamp01(level ? level() : fakeLevel(performance.now())));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [level, voice, animated, raw]);

  const shadow = `drop-shadow(0 ${size * 0.06}px ${size * 0.12}px rgba(124,92,255,${size > 60 ? 0.28 : 0.2}))`;

  return (
    <div
      className={className}
      style={{ width: size, height: size, position: "relative", flex: "none" }}
      role="img"
      aria-label={title ?? `Bits is ${state}`}
    >
      <motion.div style={{ width: "100%", height: "100%", scale: audioScale, filter: shadow }}>
        {style === "pixel" ? (
          <PixelBits state={state} f={f} level={voice ? smooth.get() : 0} />
        ) : (
          <BinaryBits state={state} f={f} size={size} animated={animated} level={smooth} />
        )}
      </motion.div>
      {state === "waiting" && style === "binary" && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 18 }}
          className="absolute rounded-full bg-[var(--a-amber)] ring-2 ring-[var(--bg)]"
          style={{ width: Math.max(8, size * 0.24), height: Math.max(8, size * 0.24), top: -1, right: -1 }}
        />
      )}
    </div>
  );
}

// ---------- Binary: a rounded square whose eyes are 0s and 1s ----------

type Glyph = "0" | "1" | "-" | "_" | "?";

/** Deterministic coin flip per frame bucket, so the "thinking" bits look random but don't flicker on re-render. */
const coin = (n: number) => (((n * 2654435761) >>> 0) >>> 7) % 2 === 1;

function binaryFace(state: MascotState, f: number) {
  const blink = f % 37 < 2;
  const face = { l: "0" as Glyph, r: "0" as Glyph, dy: 0, rot: 0 };
  switch (state) {
    case "idle":
      if (blink) face.l = face.r = "-";
      break;
    case "thinking": {
      const k = Math.floor(f / 2);
      face.l = coin(k) ? "1" : "0";
      face.r = coin(k + 101) ? "1" : "0";
      face.dy = -5;
      break;
    }
    case "working": {
      const flip = Math.floor(f / 3) % 2 === 1;
      face.l = flip ? "1" : "0";
      face.r = flip ? "0" : "1";
      face.rot = flip ? -4 : 4;
      break;
    }
    case "speaking":
      if (blink) face.l = face.r = "-";
      face.dy = -5;
      break;
    case "waiting":
      face.r = "?";
      break;
    case "offline":
      face.l = face.r = "_";
      face.dy = -8;
      break;
  }
  return face;
}

function GlyphPath({ g, cx, cy, ink }: { g: Glyph; cx: number; cy: number; ink: string }) {
  const stroke = { fill: "none", stroke: ink, strokeWidth: 7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (g) {
    case "0":
      return <rect x={cx - 8} y={cy - 12} width={16} height={24} rx={8} {...stroke} />;
    case "1":
      return <path d={`M${cx - 6} ${cy - 7}L${cx + 2} ${cy - 12}V${cy + 12}`} {...stroke} />;
    case "-":
      return <path d={`M${cx - 8} ${cy}H${cx + 8}`} {...stroke} />;
    case "_":
      return <path d={`M${cx - 8} ${cy + 10}H${cx + 8}`} {...stroke} />;
    case "?":
      return (
        <g>
          <path d={`M${cx - 7} ${cy - 5}C${cx - 7} ${cy - 14} ${cx + 8} ${cy - 14} ${cx + 8} ${cy - 5}C${cx + 8} ${cy + 1} ${cx} ${cy - 1} ${cx} ${cy + 4}`} {...stroke} />
          <circle cx={cx} cy={cy + 12.5} r={3.8} fill={ink} />
        </g>
      );
  }
}

function BinaryBits({ state, f, size, animated, level }: { state: MascotState; f: number; size: number; animated: boolean; level: MotionValue<number> }) {
  const gid = useId().replace(/:/g, "");
  const face = binaryFace(state, f);
  const sleepy = state === "offline";
  const ink = sleepy ? "#ECEAF2" : "#FFFFFF";
  const top = sleepy ? mix(SLEEPY, "#FFFFFF", 0.15) : "#9479FF";
  const bottom = sleepy ? mix(SLEEPY, "#000000", 0.1) : "#6A4BF5";
  const mouthH = useTransform(level, [0, 1], [3, 15]);
  const mouthY = useTransform(mouthH, (h) => 70 - h / 2);

  const loop = { repeat: Infinity, ease: "easeInOut" } as const;
  const spring = { type: "spring" as const, stiffness: 260, damping: 14 };
  const bodyAnim = !animated
    ? { y: 0, rotate: state === "waiting" ? -8 : 0, scale: 1 }
    : state === "thinking"
      ? { y: [0, -size * 0.05, 0], rotate: 0, scale: 1, transition: { ...loop, duration: 1.6 } }
      : state === "working"
        ? { y: 0, rotate: face.rot, scale: 1, transition: spring }
        : state === "waiting"
          ? { y: 0, rotate: -8, scale: 1, transition: spring }
          : state === "listening" || state === "speaking"
            ? { y: 0, rotate: 0, scale: 1 }
            : state === "offline"
              ? { y: 0, rotate: 0, scale: [1, 0.98, 1], transition: { ...loop, duration: 5 } }
              : { y: 0, rotate: 0, scale: [1, 1.035, 1], transition: { ...loop, duration: 4.2 } };

  return (
    <motion.svg viewBox="0 0 100 100" width="100%" height="100%" animate={bodyAnim} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`b${gid}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect x={6} y={6} width={88} height={88} rx={28} fill={`url(#b${gid})`} />
      <rect x={6} y={6} width={88} height={88} rx={28} fill="none" stroke="#FFFFFF" strokeOpacity={0.18} strokeWidth={2} />
      <g transform={`translate(0 ${face.dy})${state === "listening" ? " translate(50 48) scale(1.12) translate(-50 -48)" : ""}`}>
        <GlyphPath g={face.l} cx={36} cy={48} ink={ink} />
        <GlyphPath g={face.r} cx={64} cy={48} ink={ink} />
      </g>
      {state === "speaking" && <motion.rect x={43} width={14} rx={6} fill={ink} y={mouthY} height={mouthH} />}
    </motion.svg>
  );
}

// ---------- Pixel: an 8×8 LED sprite ----------

// The body's edge, clockwise, corners excluded (24 cells): the "working" light runs around it.
const RING: [number, number][] = [];
for (let c = 1; c <= 6; c++) RING.push([0, c]);
for (let r = 1; r <= 6; r++) RING.push([r, 7]);
for (let c = 6; c >= 1; c--) RING.push([7, c]);
for (let r = 6; r >= 1; r--) RING.push([r, 0]);

function pixelSprite(state: MascotState, f: number, level: number) {
  const sleepy = state === "offline";
  const body = sleepy ? SLEEPY : ACCENT;
  const lo = mix(body, "#000000", 0.16);
  const ink = sleepy ? "#ECEAF2" : "#FFFFFF";
  const g: (string | null)[] = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const corner = (r === 0 || r === 7) && (c === 0 || c === 7);
      g.push(corner ? null : r === 7 ? lo : body);
    }
  const set = (r: number, c: number, color: string) => {
    if (r >= 0 && r < 8 && c >= 0 && c < 8) g[r * 8 + c] = color;
  };

  const blink = f % 37 < 2;
  let eyes: [number, number][] = blink ? [[3, 2], [3, 5]] : [[2, 2], [3, 2], [2, 5], [3, 5]];
  const mouth: [number, number][] = [];
  let bob = 0;

  switch (state) {
    case "idle":
      bob = Math.floor(f / 8) % 2;
      break;
    case "thinking": {
      const dx = [-1, -1, 1, 1][Math.floor(f / 7) % 4];
      eyes = [[1, 2 + dx], [2, 2 + dx], [1, 5 + dx], [2, 5 + dx]];
      const row = f % 8; // a scanline sweeping down
      for (let c = 0; c < 8; c++) {
        const cell = g[row * 8 + c];
        if (cell) set(row, c, mix(cell, "#FFFFFF", 0.22));
      }
      break;
    }
    case "working": {
      eyes = [[3, 1], [3, 2], [3, 5], [3, 6]];
      const head = f % RING.length;
      [0.65, 0.45, 0.25].forEach((p, i) => {
        const [r, c] = RING[(head - i + RING.length) % RING.length];
        set(r, c, mix(body, "#FFFFFF", p));
      });
      bob = f % 4 < 2 ? 1 : 0;
      break;
    }
    case "listening":
      eyes = [[2, 1], [2, 2], [3, 1], [3, 2], [2, 5], [2, 6], [3, 5], [3, 6]];
      for (let i = 0; i < 4; i++) {
        const l = clamp01(level * 0.6 + 0.4 * Math.abs(Math.sin(f * 0.8 + i * 1.3)));
        mouth.push([6, 2 + i]);
        if (l > 0.5) mouth.push([5, 2 + i]);
      }
      break;
    case "speaking":
      mouth.push(
        ...((level < 0.33
          ? [[5, 3], [5, 4]]
          : level < 0.66
            ? [[5, 3], [5, 4], [6, 3], [6, 4]]
            : [[5, 2], [5, 3], [5, 4], [5, 5], [6, 3], [6, 4]]) as [number, number][]),
      );
      break;
    case "waiting":
      eyes = [[1, 3], [2, 3], [1, 6], [2, 6]];
      if (Math.floor(f / 5) % 2 === 0) set(0, 7, AMBER); // the missing corner is the "needs you" light
      break;
    case "offline":
      eyes = [[3, 1], [3, 2], [3, 5], [3, 6]];
      break;
  }
  for (const [r, c] of [...eyes, ...mouth]) set(r, c, ink);
  return { g, bob };
}

function PixelBits({ state, f, level }: { state: MascotState; f: number; level: number }) {
  const { g, bob } = pixelSprite(state, f, level);
  return (
    <svg viewBox="0 0 80 80" width="100%" height="100%" style={{ overflow: "visible" }}>
      <g transform={`translate(0 ${-bob * 3})`}>
        {g.map((color, i) =>
          color ? <rect key={i} x={(i % 8) * 10 + 0.5} y={Math.floor(i / 8) * 10 + 0.5} width={9} height={9} rx={2.2} fill={color} /> : null,
        )}
      </g>
    </svg>
  );
}
