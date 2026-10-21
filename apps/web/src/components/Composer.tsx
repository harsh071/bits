import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, AudioLines, Square } from "lucide-react";

export interface ComposerHandle {
  focus: () => void;
  setText: (t: string) => void;
}

interface Props {
  onSend: (text: string) => void;
  onMic?: () => void;
  onStop?: () => void;
  running?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Single-line look (overlay). */
  compact?: boolean;
  disabled?: boolean;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { onSend, onMic, onStop, running, placeholder = "Ask Bits anything…", autoFocus, compact, disabled },
  ref,
) {
  const [text, setText] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    setText: (t) => {
      setText(t);
      requestAnimationFrame(() => ta.current?.focus());
    },
  }));

  // Auto-grow.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, compact ? 120 : 220)}px`;
  }, [text, compact]);

  useEffect(() => {
    if (autoFocus && window.matchMedia("(pointer: fine)").matches) ta.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };

  const canSend = text.trim().length > 0 && !disabled;

  return (
    <div
      className={`flex items-end gap-1.5 ${
        compact
          ? "rounded-[14px] p-0.5 pl-1"
          : "rounded-[26px] border border-line bg-surface/95 p-2 pl-4 shadow-float backdrop-blur-xl transition-shadow focus-within:border-line-2 focus-within:shadow-lift"
      }`}
    >
      <textarea
        ref={ta}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        aria-label="Message Bits"
        className={`scroll-thin max-h-[220px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-1.5 ${compact ? "text-[16px]" : "text-[15px]"} leading-6 text-ink outline-none placeholder:text-faint focus-visible:outline-none`}
      />
      {onMic && (
        <button
          type="button"
          onClick={onMic}
          aria-label="Talk to Bits"
          title="Voice mode"
          className="grid h-9 w-9 flex-none place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-accent-ink"
        >
          <AudioLines size={18} />
        </button>
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        {running && !canSend && onStop ? (
          <motion.button
            key="stop"
            type="button"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            onClick={onStop}
            aria-label="Stop"
            title="Stop"
            className="grid h-9 w-9 flex-none place-items-center rounded-full bg-ink text-bg transition-opacity hover:opacity-85"
          >
            <Square size={13} fill="currentColor" />
          </motion.button>
        ) : (
          <motion.button
            key="send"
            type="button"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
            title="Send (Enter)"
            className={`grid h-9 w-9 flex-none place-items-center rounded-full transition-all ${
              canSend ? "bg-accent text-white shadow-[0_4px_14px_-4px_rgba(124,92,255,0.7)] hover:brightness-110" : "bg-surface-2 text-faint"
            }`}
          >
            <ArrowUp size={18} strokeWidth={2.4} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
});
