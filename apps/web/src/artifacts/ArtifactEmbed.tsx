import { motion } from "motion/react";
import { PanelRight } from "lucide-react";
import { useArtifacts } from "../store/artifacts";
import { artifactIcon } from "./icon";
import { ArtifactView } from "./ArtifactView";

export function KindBadge({ kind }: { kind?: string }) {
  if (!kind) return null;
  return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium capitalize text-accent-ink">{kind}</span>;
}

/** An artifact inline in the chat: header + live view. */
export function ArtifactEmbed({ id, fallbackTitle, updated }: { id: string; fallbackTitle?: string; updated?: boolean }) {
  const meta = useArtifacts((s) => s.byId[id]);
  const openPanel = useArtifacts((s) => s.openPanel);
  const Icon = artifactIcon(meta ?? {});
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-soft"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-accent-soft text-accent-ink">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold tracking-[-0.01em] text-ink">{meta?.title ?? fallbackTitle ?? "Artifact"}</span>
            <KindBadge kind={meta?.kind} />
          </div>
          <div className="truncate text-[12.5px] text-muted">
            {updated ? `Updated · v${meta?.version ?? "…"}` : (meta?.description ?? "A little app Bits made for you")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => openPanel(id)}
          className="flex flex-none items-center gap-1.5 rounded-full border border-line-2 px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-accent/50 hover:text-accent-ink"
        >
          <PanelRight size={14} /> Open
        </button>
      </div>
      <div className="scroll-thin max-h-[560px] overflow-y-auto p-4">
        <ArtifactView id={id} />
      </div>
    </motion.div>
  );
}

/** While the artifact is being created (no result yet). */
export function ArtifactPending({ title, failed }: { title?: string; failed?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[20px] border border-dashed border-line-2 bg-surface/60 px-4 py-3.5">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-surface-2 text-muted">
        {(() => {
          const I = artifactIcon({});
          return <I size={18} />;
        })()}
      </span>
      <div className="min-w-0">
        <div className={`truncate font-medium ${failed ? "text-ink-2" : "shimmer"}`}>{failed ? `Couldn’t build “${title ?? "artifact"}”` : `Building ${title ? `“${title}”` : "an artifact"}…`}</div>
        {failed && <div className="line-clamp-2 text-[12.5px] text-muted">{failed}</div>}
      </div>
    </div>
  );
}
