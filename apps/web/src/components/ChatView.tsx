import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { HOME, isTerminal, useChat } from "../store/chat";
import { buildBlocks } from "../lib/blocks";
import { Thread } from "./Thread";
import { Composer, type ComposerHandle } from "./Composer";
import { EmptyState } from "./EmptyState";
import { Header } from "./Header";
import { useVoice } from "../voice/voice";

const EMPTY: never[] = [];

export function ChatView({ onMenu }: { onMenu: () => void }) {
  const id = useChat((s) => s.activeId);
  const conv = useChat((s) => s.convs[id]);
  const pending = useChat((s) => s.pending[id] ?? EMPTY);
  const live = useChat((s) => s.live[id]);
  const turn = useChat((s) => s.turns[id]);
  const offline = useChat((s) => s.connection === "offline");
  const title = useChat((s) => s.conversations.find((c) => c.id === id)?.title) ?? (id === HOME ? "Home" : "Chat");
  const send = useChat((s) => s.send);
  const retry = useChat((s) => s.retry);
  const discard = useChat((s) => s.discard);
  const cancel = useChat((s) => s.cancel);
  const ensureLoaded = useChat((s) => s.ensureLoaded);
  const startVoice = useVoice((s) => s.start);

  useEffect(() => {
    void ensureLoaded(id);
  }, [id, ensureLoaded]);

  const running = !!turn && !isTerminal(turn.status) && turn.status !== "waiting";
  const waiting = turn?.status === "waiting";
  const blocks = useMemo(
    () => buildBlocks(conv?.messages ?? EMPTY, { pending, live, runningTurnId: running ? (turn?.turnId ?? live?.turnId ?? null) : null }),
    [conv?.messages, pending, live, running, turn?.turnId],
  );

  // ---- Sticky-bottom scrolling ----
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const onScroll = () => {
    const el = scroller.current!;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    stick.current = near;
    setAtBottom(near);
  };
  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useLayoutEffect(() => {
    if (stick.current && blocks.length) toBottom();
  }, [blocks, toBottom]);
  useLayoutEffect(() => {
    stick.current = true;
    toBottom();
  }, [id, toBottom]);
  // Content inside (charts, images) can grow after render.
  useEffect(() => {
    const el = scroller.current?.firstElementChild;
    if (!el) return;
    const ro = new ResizeObserver(() => stick.current && el.querySelector("[data-thread]") && toBottom());
    ro.observe(el);
    return () => ro.disconnect();
  }, [toBottom]);

  const composer = useRef<ComposerHandle>(null);
  const onSend = useCallback(
    (text: string) => {
      stick.current = true;
      void send(id, text);
    },
    [id, send],
  );

  const showEmpty = blocks.length === 0 && (conv?.loaded || offline || !!conv?.error);

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="min-h-full">
          <Header conversationId={id} title={title} onMenu={onMenu} />
          <div className="mx-auto w-full max-w-[740px] px-4 pb-44 sm:px-6">
            {showEmpty ? (
              <EmptyState onPick={onSend} />
            ) : (
              <Thread
                blocks={blocks}
                onSend={onSend}
                onRetry={(mid) => void retry(id, mid)}
                onDiscard={(mid) => discard(id, mid)}
                running={running || (!!live && !isTerminal(turn?.status))}
                waiting={waiting}
                activity={turn?.activity}
              />
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-bg via-bg/85 to-bg/0 px-3 pt-10 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5">
        <div className="pointer-events-auto relative mx-auto w-full max-w-[740px]">
          <AnimatePresence>
            {!atBottom && blocks.length > 0 && (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                onClick={() => {
                  stick.current = true;
                  toBottom(true);
                }}
                aria-label="Scroll to latest"
                className="absolute -top-12 left-1/2 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-muted shadow-float hover:text-ink"
              >
                <ArrowDown size={16} />
              </motion.button>
            )}
          </AnimatePresence>
          <Composer
            ref={composer}
            onSend={onSend}
            onMic={() => void startVoice(id)}
            onStop={() => void cancel(id).catch(() => {})}
            running={running}
            autoFocus
            placeholder={waiting ? "Reply to Bits…" : running ? "Add something — Bits will read it between steps…" : "Ask Bits anything…"}
          />
        </div>
      </div>
    </div>
  );
}
