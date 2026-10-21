import { motion } from "motion/react";
import { CalendarDays, Coffee, Heart, Sunrise } from "lucide-react";
import { Mascot } from "./Mascot";
import { greeting } from "../lib/text";

const SUGGESTIONS = [
  { icon: CalendarDays, text: "Plan my week" },
  { icon: Heart, text: "What do you remember about me?" },
  { icon: Sunrise, text: "Set up a morning brief at 8am on weekdays" },
  { icon: Coffee, text: "Research the best espresso grinder under $300 and show me a comparison" },
];

export function EmptyState({ onPick, compact }: { onPick: (text: string) => void; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? "py-6" : "min-h-[calc(100dvh-230px)] justify-center py-6"}`}>
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 14 }}>
        <Mascot state="idle" size={compact ? 64 : 88} />
      </motion.div>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="mt-5 font-serif text-[38px] leading-[1.05] tracking-[-0.015em] text-ink sm:text-[46px]"
      >
        {greeting()}
      </motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.16 }} className="mt-2 text-[15px] text-muted">
        I’m here whenever you need me. What’s on your mind?
      </motion.p>
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.22 } } }}
        className="mt-7 grid w-full max-w-[560px] grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {SUGGESTIONS.map(({ icon: Icon, text }) => (
          <motion.button
            key={text}
            type="button"
            variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onPick(text)}
            className="flex items-start gap-3 rounded-[16px] border border-line bg-surface px-3.5 py-3 text-left text-[14px] leading-snug text-ink-2 shadow-soft transition-colors hover:border-accent/40 hover:text-ink"
          >
            <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-accent-soft text-accent-ink">
              <Icon size={15} />
            </span>
            <span className="pt-[3px]">{text}</span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
