import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Maximize2, X } from "lucide-react";
import { useArtifacts } from "../store/artifacts";
import { useChat } from "../store/chat";
import { IconButton } from "../components/IconButton";
import { artifactIcon } from "./icon";
import { KindBadge } from "./ArtifactEmbed";
import { ArtifactView } from "./ArtifactView";

function useWide() {
  const q = "(min-width: 1100px)";
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

function PanelBody({ id, onClose }: { id: string; onClose: () => void }) {
  const meta = useArtifacts((s) => s.byId[id]);
  const openPage = useArtifacts((s) => s.openPage);
  const Icon = artifactIcon(meta ?? {});
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="drag flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-accent-soft text-accent-ink">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-ink">{meta?.title ?? "Artifact"}</span>
            <KindBadge kind={meta?.kind} />
          </div>
        </div>
        <IconButton
          label="Open full page"
          size="sm"
          onClick={() => {
            openPage(id);
            useChat.getState().setView("artifacts");
            onClose();
          }}
        >
          <Maximize2 size={15} />
        </IconButton>
        <IconButton label="Close panel" size="sm" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        <ArtifactView id={id} />
      </div>
    </div>
  );
}

/** Right-hand panel next to the thread on wide screens; a bottom sheet on narrow ones. */
export function ArtifactPanel() {
  const id = useArtifacts((s) => s.panelId);
  const close = () => useArtifacts.getState().openPanel(null);
  const wide = useWide();

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id]);

  if (wide) {
    return (
      <AnimatePresence initial={false}>
        {id && (
          <motion.aside
            key="panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 460, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            className="h-full flex-none overflow-hidden border-l border-line bg-bg-2"
            aria-label="Artifact"
          >
            <div className="h-full w-[460px]">
              <PanelBody key={id} id={id} onClose={close} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }
  return (
    <AnimatePresence>
      {id && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-[rgba(20,16,35,0.3)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            className="fixed inset-x-0 bottom-0 z-50 h-[86dvh] overflow-hidden rounded-t-[24px] border border-line bg-bg shadow-lift"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
          >
            <PanelBody key={id} id={id} onClose={close} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
