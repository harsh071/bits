import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useChat } from "./store/chat";
import { startSync } from "./store/sync";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { MemoryView } from "./components/MemoryView";
import { ArtifactsView } from "./artifacts/ArtifactsView";
import { ArtifactPanel } from "./artifacts/ArtifactPanel";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { VoiceOverlay } from "./voice/VoiceOverlay";

export function App() {
  const view = useChat((s) => s.view);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    startSync();
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg">
      <aside className="hidden w-[264px] flex-none border-r border-line bg-bg-2 md:block">
        <Sidebar />
      </aside>

      <AnimatePresence>
        {sheet && (
          <>
            <motion.div
              key="scrim"
              className="fixed inset-0 z-40 bg-[rgba(20,16,35,0.3)] backdrop-blur-[2px] md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheet(false)}
            />
            <motion.aside
              key="sheet"
              className="fixed inset-y-0 left-0 z-50 w-[min(300px,86vw)] border-r border-line bg-bg-2 shadow-lift md:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              aria-label="Navigation"
            >
              <Sidebar onNavigate={() => setSheet(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="flex min-w-0 flex-1">
        {view === "memory" ? (
          <MemoryView onMenu={() => setSheet(true)} />
        ) : view === "artifacts" ? (
          <ArtifactsView onMenu={() => setSheet(true)} />
        ) : (
          <>
            <ChatView onMenu={() => setSheet(true)} />
            <ArtifactPanel />
          </>
        )}
      </main>

      <ConnectionBanner />
      <VoiceOverlay />
    </div>
  );
}
