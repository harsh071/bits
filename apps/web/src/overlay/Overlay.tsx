import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { HOME, isTerminal, useChat } from "../store/chat";
import { buildBlocks } from "../lib/blocks";
import { useAgentStatus } from "../lib/status";
import { desktop } from "../lib/desktop";
import { Mascot } from "../components/Mascot";
import { Composer, type ComposerHandle } from "../components/Composer";
import { Thread } from "../components/Thread";

const EMPTY: never[] = [];

/** Quick launcher: a compact floating prompt that expands to show the reply (Home conversation). */
export function Overlay() {
  const conv = useChat((s) => s.convs[HOME]);
  const pending = useChat((s) => s.pending[HOME] ?? EMPTY);
  const live = useChat((s) => s.live[HOME]);
  const turn = useChat((s) => s.turns[HOME]);
  const send = useChat((s) => s.send);
  const cancel = useChat((s) => s.cancel);
  const ensureLoaded = useChat((s) => s.ensureLoaded);
  const status = useAgentStatus(HOME);
  const [since, setSince] = useState<{ seq: number; id: string } | null>(null);

  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);

  useEffect(() => {
    void ensureLoaded(HOME);
  }, [ensureLoaded]);

  // Escape hides the window; focus the prompt whenever the shell shows us.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") desktop()?.hideOverlay?.();
    };
    window.addEventListener("keydown", onKey);
    const off = desktop()?.onOverlayShown?.(() => composer.current?.focus());
    composer.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      off?.();
    };
  }, []);

  // Tell the shell how tall we are so the transparent window hugs the panel.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const report = () => desktop()?.resizeOverlay?.(Math.ceil(el.getBoundingClientRect().height) + 32);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, []);

  const running = !!turn && !isTerminal(turn.status) && turn.status !== "waiting";
  const blocks = useMemo(() => {
    if (!since) return [];
    const msgs = (conv?.messages ?? EMPTY).filter((m) => m.seq > since.seq || m.id === since.id);
    return buildBlocks(msgs, {
      pending: pending.filter((p) => p.id === since.id),
      live,
      runningTurnId: running ? (turn?.turnId ?? live?.turnId ?? null) : null,
    });
  }, [since, conv?.messages, pending, live, running, turn?.turnId]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  const onSend = (text: string) => {
    const id = crypto.randomUUID();
    setSince({ seq: useChat.getState().convs[HOME]?.lastSeq ?? 0, id });
    void send(HOME, text, { id });
  };
  const expanded = !!since;

  return (
    <div className="flex min-h-screen items-start justify-center p-4">
      <motion.div
        ref={panel}
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="w-full max-w-[648px] overflow-hidden rounded-[20px] border border-line bg-[var(--glass)] shadow-[0_18px_50px_-18px_rgba(30,20,70,0.45),0_2px_8px_-2px_rgba(0,0,0,0.08)] backdrop-blur-2xl backdrop-saturate-150"
      >
        <div className="drag flex items-center gap-2.5 p-2.5 pl-3">
          <Mascot state={status.state} size={32} />
          <div className="no-drag min-w-0 flex-1">
            <Composer
              ref={composer}
              compact
              onSend={onSend}
              running={running}
              onStop={() => void cancel(HOME).catch(() => {})}
              placeholder={status.state === "waiting" ? "Bits needs your OK…" : "Ask Bits…"}
              autoFocus
            />
          </div>
        </div>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 32 }}
              className="overflow-hidden border-t border-line"
            >
              <div ref={scroller} className="scroll-thin max-h-[min(560px,70vh)] overflow-y-auto px-4 py-4">
                <Thread
                  blocks={blocks}
                  onSend={onSend}
                  onRetry={(id) => void useChat.getState().retry(HOME, id)}
                  running={running || !!live}
                  waiting={turn?.status === "waiting"}
                  activity={turn?.activity}
                />
              </div>
              <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[12px] text-muted">
                <span className="truncate">{status.label}</span>
                <a
                  href="/"
                  onClick={(e) => {
                    const d = desktop();
                    if (d?.openMain) {
                      e.preventDefault();
                      d.openMain();
                    }
                  }}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-none items-center gap-1 rounded-full px-2 py-1 font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  Open in Bits <ArrowUpRight size={13} />
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
