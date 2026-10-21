import { motion } from "motion/react";
import { MessageCircleQuestion } from "lucide-react";
import type { AskUserInput } from "@bits/protocol";

export function AskUser({
  input,
  answered,
  highlight,
  onAnswer,
}: {
  input: AskUserInput;
  answered: boolean;
  highlight: boolean;
  onAnswer?: (text: string) => void;
}) {
  const options = Array.isArray(input?.options) ? input.options.filter((o) => typeof o === "string") : [];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-[18px] border p-4 transition-colors ${
        highlight ? "border-accent/40 bg-accent-soft shadow-float" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <MessageCircleQuestion size={18} className={`mt-[2px] flex-none ${highlight ? "text-accent" : "text-muted"}`} />
        <div className="font-medium text-ink">{String(input?.question ?? "")}</div>
      </div>
      {options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 pl-[28px]">
          {options.map((o) => (
            <motion.button
              key={o}
              type="button"
              whileTap={{ scale: 0.96 }}
              disabled={answered || !onAnswer}
              onClick={() => onAnswer?.(o)}
              className="rounded-full border border-line-2 bg-surface px-3.5 py-1.5 text-[13.5px] text-ink transition-all hover:border-accent hover:text-accent-ink disabled:opacity-50 disabled:hover:border-line-2 disabled:hover:text-ink"
            >
              {o}
            </motion.button>
          ))}
        </div>
      )}
      {highlight && !options.length && <div className="mt-2 pl-[28px] text-[13px] text-muted">Reply below and Bits will pick it up.</div>}
    </motion.div>
  );
}
