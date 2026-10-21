import { useEffect } from "react";
import { ArrowUpRight, Moon, Sun } from "lucide-react";
import { useArtifacts } from "../store/artifacts";
import { useAgentStatus } from "../lib/status";
import { useTheme } from "../store/theme";
import { Mascot } from "../components/Mascot";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { KindBadge } from "./ArtifactEmbed";
import { ArtifactView } from "./ArtifactView";

/** `/?artifact=<id>`: one artifact on its own, pinnable in a tab for browser (WebMCP) agents. */
export function StandaloneArtifact({ id }: { id: string }) {
  const meta = useArtifacts((s) => s.byId[id]);
  const status = useAgentStatus(meta?.conversationId ?? "home");
  const { dark, cycle } = useTheme();
  useEffect(() => {
    document.title = meta ? `${meta.title} · Bits` : "Bits";
  }, [meta]);
  return (
    <div className="min-h-dvh bg-bg">
      <header className="drag traffic-pad sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-2.5 backdrop-blur-xl sm:px-6">
        <Mascot state={status.state} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold tracking-[-0.01em] text-ink">{meta?.title ?? "Artifact"}</span>
            <KindBadge kind={meta?.kind} />
          </div>
          <div className="truncate text-[12px] text-muted">{meta?.description ?? status.label}</div>
        </div>
        <button type="button" onClick={cycle} aria-label={dark ? "Light mode" : "Dark mode"} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <a href="/" className="flex flex-none items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
          Open Bits <ArrowUpRight size={13} />
        </a>
      </header>
      <main className="mx-auto w-full max-w-[920px] px-4 py-6 sm:px-6">
        <div className="rounded-[22px] border border-line bg-surface p-4 shadow-soft sm:p-6">
          <ArtifactView id={id} />
        </div>
      </main>
      <ConnectionBanner />
    </div>
  );
}
