import { useEffect, useId, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";

export type MascotState = "idle" | "thinking" | "working" | "listening" | "speaking" | "waiting" | "offline";

/** A soft six-lobed blob, smoothed with Catmull-Rom → cubic Béziers. */
function blobPath(lobes = 6, amp = 0.065, r = 40, cx = 50, cy = 50, n = 48) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const rr = r * (1 + amp * Math.cos(lobes * t));
    pts.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
  }
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return `${d}Z`;
}
const BODY = blobPath();

interface Props {
  state?: MascotState;
  size?: number;
  /** Live audio level 0..1, polled every frame while listening/speaking. */
  level?: () => number;
  className?: string;
  title?: string;
}

export function Mascot({ state = "idle", size = 40, level, className, title }: Props) {
  const reduce = useReducedMotion();
  const gid = useId().replace(/:/g, "");
  const [blink, setBlink] = useState(false);

  // Occasional blink (not while waiting or offline: those have their own eyes).
  useEffect(() => {
    if (reduce || state === "offline") return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(
        () => {
          setBlink(true);
          setTimeout(() => setBlink(false), 140);
          loop();
        },
        2800 + Math.random() * 3600,
      );
    };
    loop();
    return () => clearTimeout(t);
  }, [reduce, state]);

  // Audio-reactive scale.
  const raw = useMotionValue(0);
  const smooth = useSpring(raw, { stiffness: 300, damping: 22, mass: 0.6 });
  const audioScale = useTransform(smooth, [0, 1], [1, 1.22]);
  useEffect(() => {
    if (!level || (state !== "listening" && state !== "speaking")) {
      raw.set(0);
      return;
    }
    let id = 0;
    const tick = () => {
      raw.set(Math.min(1, Math.max(0, level())));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [level, state, raw]);

  const loop = { repeat: Infinity, ease: "easeInOut" } as const;
  const bodyAnim = reduce
    ? { y: 0, rotate: state === "waiting" ? -8 : 0, scale: 1 }
    : state === "thinking"
      ? { y: [0, -size * 0.06, 0], rotate: [0, 2, 0], scale: 1, transition: { ...loop, duration: 1.6 } }
      : state === "working"
        ? { y: [0, -size * 0.025, 0], rotate: [-5, 5, -5], scale: 1, transition: { ...loop, duration: 0.9 } }
        : state === "waiting"
          ? { y: 0, rotate: -10, scale: 1, transition: { type: "spring" as const, stiffness: 200, damping: 12 } }
          : state === "listening" || state === "speaking"
            ? { y: 0, rotate: 0, scale: 1 }
            : state === "offline"
              ? { y: 0, rotate: 0, scale: [1, 0.98, 1], transition: { ...loop, duration: 5 } }
              : { y: 0, rotate: 0, scale: [1, 1.035, 1], transition: { ...loop, duration: 4.2 } };

  const lookAnim =
    reduce || state !== "thinking"
      ? { x: state === "waiting" ? 2 : 0, y: state === "waiting" ? -2 : 0 }
      : { x: [0, -4, -4, 4, 4, 0], y: [0, -2, -2, -2, -2, 0], transition: { ...loop, duration: 3.6 } };

  const sleepy = state === "offline";
  const eyeScale = blink ? 0.12 : sleepy ? 0.28 : state === "listening" ? 1.08 : 1;

  return (
    <div
      className={className}
      style={{ width: size, height: size, position: "relative", flex: "none" }}
      role="img"
      aria-label={title ?? `Bits is ${state}`}
    >
      <motion.div style={{ width: "100%", height: "100%", scale: audioScale }}>
        <motion.svg
          viewBox="0 0 100 100"
          width="100%"
          height="100%"
          animate={bodyAnim}
          style={{ overflow: "visible", filter: `drop-shadow(0 ${size * 0.06}px ${size * 0.12}px rgba(124,92,255,${size > 60 ? 0.3 : 0.22}))` }}
        >
          <defs>
            <radialGradient id={`b${gid}`} cx="36%" cy="28%" r="80%">
              <stop offset="0" stopColor={sleepy ? "#C9BFEA" : "#B8A6FF"} />
              <stop offset="0.5" stopColor={sleepy ? "#A898D8" : "#8A6CFF"} />
              <stop offset="1" stopColor={sleepy ? "#8C7CC0" : "#5E3DF0"} />
            </radialGradient>
            <radialGradient id={`h${gid}`} cx="34%" cy="24%" r="38%">
              <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <motion.g
            style={{ originX: 0.5, originY: 0.5 }}
            animate={reduce ? undefined : { rotate: 360 }}
            transition={{ repeat: Infinity, duration: state === "working" ? 14 : 48, ease: "linear" }}
          >
            <path d={BODY} fill={`url(#b${gid})`} />
            <path d={BODY} fill={`url(#h${gid})`} />
          </motion.g>
          <motion.g animate={lookAnim}>
            {[37, 54].map((x) => (
              <motion.rect
                key={x}
                x={x}
                y={33}
                width={9}
                height={22}
                rx={4.5}
                fill="#fff"
                style={{ originX: 0.5, originY: 0.5 }}
                animate={{ scaleY: eyeScale }}
                transition={{ duration: 0.12 }}
              />
            ))}
          </motion.g>
        </motion.svg>
      </motion.div>
      {state === "waiting" && (
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
