import { AnimatePresence, motion } from "motion/react";
import { Menu } from "lucide-react";
import { Mascot } from "./Mascot";
import { IconButton } from "./IconButton";
import { useAgentStatus } from "../lib/status";

export function Header({ conversationId, title, onMenu }: { conversationId: string; title: string; onMenu: () => void }) {
  const status = useAgentStatus(conversationId);
  return (
    <header className="drag traffic-pad sticky top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-bg via-bg/90 to-bg/0 px-3 pt-3 pb-5 sm:px-6">
      <IconButton label="Open menu" onClick={onMenu} className="md:hidden">
        <Menu size={18} />
      </IconButton>
      <div className="mx-auto flex min-w-0 items-center gap-2.5 rounded-full border border-line bg-surface/80 py-1 pr-4 pl-1.5 shadow-soft backdrop-blur-xl">
        <Mascot state={status.state} size={30} />
        <div className="min-w-[128px] leading-tight">
          <div className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{title}</div>
          <div className="relative h-[17px] overflow-hidden text-[12px] text-muted" aria-live="polite">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={status.label}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ duration: 0.22 }}
                className={`truncate ${status.state === "waiting" ? "font-medium text-[var(--a-amber)]" : ""}`}
              >
                {status.label}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className="w-9 md:hidden" />
    </header>
  );
}
