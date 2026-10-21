import { memo } from "react";
import { motion } from "motion/react";
import { CircleAlert, Mic, RotateCcw, Sparkles, X, Zap } from "lucide-react";
import type { Block } from "../lib/blocks";
import { GenUIBlock } from "../genui";
import { Markdown } from "./Markdown";
import { Mascot } from "./Mascot";
import { ToolRun } from "./Activity";
import { ApprovalCard } from "./ApprovalCard";
import { AskUser } from "./AskUser";

export interface ThreadProps {
  blocks: Block[];
  onSend?: (text: string) => void;
  onRetry?: (id: string) => void;
  onDiscard?: (id: string) => void;
  running?: boolean;
  waiting?: boolean;
  activity?: string;
}

/** Static mini mascot used as the assistant avatar. */
export function MiniBit({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="flex-none">
      <defs>
        <radialGradient id="minibit" cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="#B8A6FF" />
          <stop offset=".55" stopColor="#8A6CFF" />
          <stop offset="1" stopColor="#5E3DF0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="28" fill="url(#minibit)" />
      <rect x="22" y="21" width="6.5" height="15" rx="3.25" fill="#fff" />
      <rect x="35.5" y="21" width="6.5" height="15" rx="3.25" fill="#fff" />
    </svg>
  );
}

const enter = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.28, ease: "easeOut" } } as const;

function UserBubble({ block, onRetry, onDiscard }: { block: Extract<Block, { kind: "user" }> } & Pick<ThreadProps, "onRetry" | "onDiscard">) {
  const failed = block.pending?.status === "failed";
  const sending = block.pending?.status === "sending";
  return (
    <motion.div {...enter} className="flex flex-col items-end gap-1 pl-10 sm:pl-16">
      <div
        className={`max-w-full rounded-[20px] rounded-br-[6px] bg-[var(--user-bubble)] px-4 py-2.5 text-[var(--user-bubble-ink)] transition-opacity ${
          sending ? "opacity-70" : ""
        } ${failed ? "ring-1 ring-danger/40" : ""}`}
      >
        <div className="whitespace-pre-wrap break-words">{block.text}</div>
      </div>
      {(block.source === "voice" || block.steering) && !failed && (
        <div className="flex items-center gap-1 pr-1 text-[11.5px] text-faint">
          {block.source === "voice" && <Mic size={11} />}
          {block.steering && <span>Sent while Bits was working</span>}
          {block.source === "voice" && !block.steering && <span>Voice</span>}
        </div>
      )}
      {failed && (
        <div className="flex items-center gap-2 pr-1 text-[12.5px]">
          <span className="flex items-center gap-1 text-danger">
            <CircleAlert size={13} /> Not sent
          </span>
          <button type="button" onClick={() => onRetry?.(block.key)} className="flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-ink hover:bg-surface-2">
            <RotateCcw size={12} /> Retry
          </button>
          <button type="button" aria-label="Discard message" onClick={() => onDiscard?.(block.key)} className="rounded-full p-0.5 text-muted hover:bg-surface-2 hover:text-ink">
            <X size={13} />
          </button>
        </div>
      )}
    </motion.div>
  );
}

function EventLine({ block }: { block: Extract<Block, { kind: "event" }> }) {
  const Icon = block.source === "routine" ? Zap : Sparkles;
  return (
    <motion.div {...enter} className="flex items-center justify-center gap-3 py-1 text-[12.5px] text-muted">
      <span className="h-px w-8 bg-line" />
      <span className="flex items-center gap-1.5 text-center">
        <Icon size={12} className="flex-none text-faint" />
        {block.text}
      </span>
      <span className="h-px w-8 bg-line" />
    </motion.div>
  );
}

function ThinkingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[13.5px]">
      <span className="shimmer font-medium">{label}</span>
    </div>
  );
}

function AssistantBlock({
  block,
  isLast,
  onSend,
  running,
  waiting,
  activity,
}: { block: Extract<Block, { kind: "assistant" }>; isLast: boolean } & ThreadProps) {
  const live = isLast && running && block.running;
  const lastAsk = [...block.items].reverse().find((i) => i.kind === "ask" && !i.answered);
  const lastItem = block.items[block.items.length - 1];
  const chipRunning = lastItem?.kind === "tools" && lastItem.steps.flat().some((c) => !c.result);
  const showThinking = live && !block.live && !chipRunning;
  return (
    <motion.div {...enter} className="flex gap-3">
      <div className="pt-[1px]">{live ? <Mascot state={activity && !/^think/i.test(activity) ? "working" : "thinking"} size={22} /> : <MiniBit />}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {block.items.map((item) => {
          switch (item.kind) {
            case "text":
              return <Markdown key={item.key} text={item.text} />;
            case "ui":
              return (
                <div key={item.key} className="my-1">
                  <GenUIBlock part={item.part} onAction={onSend} />
                </div>
              );
            case "ask":
              return (
                <AskUser
                  key={item.key}
                  input={item.input}
                  answered={item.answered}
                  highlight={!!waiting && isLast && item === lastAsk}
                  onAnswer={onSend}
                />
              );
            case "tools":
              return <ToolRun key={item.key} steps={item.steps} live={live} />;
            case "approval":
              return <ApprovalCard key={item.key} call={item.call} />;
          }
        })}
        {block.live && (
          <div className={`fade-in-text ${live ? "streaming" : ""}`}>
            <Markdown text={block.live} />
          </div>
        )}
        {showThinking && <ThinkingRow label={activity || "Thinking…"} />}
      </div>
    </motion.div>
  );
}

export const Thread = memo(function Thread(props: ThreadProps) {
  const { blocks, running, activity } = props;
  const last = blocks[blocks.length - 1];
  const needsTail = running && (!last || last.kind !== "assistant" || !last.running);
  return (
    <div data-thread className="flex flex-col gap-6">
      {blocks.map((b, i) =>
        b.kind === "user" ? (
          <UserBubble key={b.key} block={b} onRetry={props.onRetry} onDiscard={props.onDiscard} />
        ) : b.kind === "event" ? (
          <EventLine key={b.key} block={b} />
        ) : (
          <AssistantBlock key={b.key} block={b} isLast={i === blocks.length - 1} {...props} />
        ),
      )}
      {needsTail && (
        <motion.div {...enter} className="flex items-center gap-3">
          <Mascot state={activity && !/^think/i.test(activity) ? "working" : "thinking"} size={22} />
          <ThinkingRow label={activity || "Thinking…"} />
        </motion.div>
      )}
    </div>
  );
});
