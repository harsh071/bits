import { AnimatePresence, motion } from "motion/react";
import { useChat } from "../store/chat";
import { Mascot } from "./Mascot";

export function ConnectionBanner() {
  const offline = useChat((s) => s.connection === "offline");
  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          role="status"
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 12, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="pointer-events-none fixed inset-x-0 bottom-[96px] z-50 flex justify-center px-4 md:left-[264px]"
        >
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-line bg-surface/95 py-1.5 pr-4 pl-2 text-[13px] text-ink-2 shadow-float backdrop-blur-xl">
            <Mascot state="offline" size={22} />
            <span>
              <span className="font-medium text-ink">Bits is waking up…</span>
              <span className="hidden text-muted sm:inline"> I’ll reconnect on my own.</span>
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
