import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mic, MicOff, X } from "lucide-react";
import { Mascot, type MascotState } from "../components/Mascot";
import { useVoice } from "./voice";
import { micLevel, outLevel } from "./levels";
import { stripMarkdown } from "../lib/text";

const PHASE_LABEL: Record<string, string> = {
  starting: "Warming up…",
  listening: "Listening",
  transcribing: "Got it…",
  thinking: "Thinking…",
  speaking: "Speaking",
  error: "Hmm",
};

function tail(text: string, n = 220) {
  const t = stripMarkdown(text);
  if (t.length <= n) return t;
  const cut = t.slice(-n);
  const sp = cut.indexOf(" ");
  return `…${cut.slice(sp > 0 ? sp + 1 : 0)}`;
}

export function VoiceOverlay() {
  const { active, phase, muted, userCaption, botCaption, error, stop, toggleMute } = useVoice();

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stop]);

  const mascot: MascotState =
    phase === "speaking" ? "speaking" : phase === "thinking" || phase === "transcribing" ? "thinking" : phase === "error" ? "waiting" : muted ? "idle" : "listening";

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-between overflow-hidden bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] px-6 pt-[12vh] pb-[max(32px,env(safe-area-inset-bottom))] backdrop-blur-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          role="dialog"
          aria-modal="true"
          aria-label="Voice conversation with Bits"
        >
          {/* soft halo */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute top-[8vh] left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.22),transparent_65%)]"
            animate={{ scale: phase === "speaking" ? [1, 1.08, 1] : 1 }}
            transition={{ repeat: Infinity, duration: 2.4 }}
          />
          <div className="relative flex flex-col items-center">
            <motion.div initial={{ scale: 0.5, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 160, damping: 14 }}>
              <Mascot state={mascot} size={168} level={phase === "speaking" ? outLevel : micLevel} />
            </motion.div>
            <AnimatePresence mode="wait">
              <motion.div
                key={muted ? "muted" : phase}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className={`mt-8 text-[13px] font-medium tracking-[0.08em] uppercase ${phase === "thinking" ? "shimmer" : "text-muted"}`}
              >
                {muted ? "Muted" : PHASE_LABEL[phase]}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="relative flex w-full max-w-[620px] flex-col items-center gap-4 text-center">
            {error ? (
              <p className="max-w-[440px] text-[15px] text-ink-2">{error}</p>
            ) : (
              <>
                <AnimatePresence mode="popLayout">
                  {userCaption && (
                    <motion.p key={`u${userCaption.length > 0}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[15px] text-muted">
                      “{tail(userCaption, 160)}”
                    </motion.p>
                  )}
                </AnimatePresence>
                {botCaption && (
                  <motion.p
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="font-serif text-[24px] leading-snug tracking-[-0.01em] text-ink sm:text-[28px]"
                  >
                    {tail(botCaption)}
                  </motion.p>
                )}
                {!userCaption && !botCaption && phase === "listening" && <p className="text-[15px] text-muted">Go ahead — I’m listening.</p>}
              </>
            )}

            <div className="mt-6 flex items-center gap-4">
              <button
                type="button"
                onClick={toggleMute}
                disabled={!!error}
                aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                aria-pressed={muted}
                className={`grid h-14 w-14 place-items-center rounded-full border transition-all active:scale-95 disabled:opacity-40 ${
                  muted ? "border-transparent bg-ink text-bg" : "border-line bg-surface text-ink shadow-float hover:bg-surface-2"
                }`}
              >
                {muted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
              <button
                type="button"
                onClick={stop}
                aria-label="End voice conversation"
                className="grid h-14 w-14 place-items-center rounded-full bg-[var(--danger)] text-white shadow-float transition-all hover:brightness-110 active:scale-95"
              >
                <X size={24} />
              </button>
            </div>
            <div className="text-[12px] text-faint">Talk over Bits anytime to interrupt · Esc to end</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
