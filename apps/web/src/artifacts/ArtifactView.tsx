import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert } from "lucide-react";
import { Renderer } from "@agentable-ui/genui";
import { ToolScope } from "@agentable-ui/react";
import { claimArtifact, isArtifactOwner, onOwnersChange, useArtifacts } from "../store/artifacts";
import { useChat } from "../store/chat";
import { catalog } from "../genui/catalog";
import { GenBoundary, IssuesNote, type Issue } from "../genui/Boundary";
import { JsonPreview } from "../genui/GenUI";
import { ArtifactTools } from "./ArtifactTools";

const uiKey = (id: string) => `bits.ui.${id}`;
function readUi(id: string): Record<string, unknown> | undefined {
  try {
    const raw = localStorage.getItem(uiKey(id));
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Is this instance the one that registers WebMCP tools for the artifact? */
function useOwnership(id: string) {
  const instance = useId();
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    const release = claimArtifact(id, instance);
    const update = () => setOwner(isArtifactOwner(id, instance));
    const off = onOwnersChange(update);
    update();
    return () => {
      off();
      release();
    };
  }, [id, instance]);
  return owner;
}

/**
 * A live artifact: its Agentable Lang view rendered against its saved data. Shared by the chat
 * embed, side panel, artifact page and the standalone `/?artifact=` page.
 */
export function ArtifactView({ id, className = "" }: { id: string; className?: string }) {
  const artifact = useArtifacts((s) => s.byId[id]);
  const error = useArtifacts((s) => s.errors[id]);
  const load = useArtifacts((s) => s.load);
  const owner = useOwnership(id);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!useArtifacts.getState().byId[id]) void load(id);
  }, [id, load]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const actionNames = useMemo(() => Object.keys(artifact?.actions ?? {}).sort().join(","), [artifact?.actions]);
  const tools = useMemo(() => {
    const out: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
    for (const name of actionNames ? actionNames.split(",") : []) {
      out[name] = async (args) => {
        try {
          return await useArtifacts.getState().run(id, name, args, "person");
        } catch (err) {
          showToast((err as Error).message || "That didn’t work.");
          throw err;
        }
      };
    }
    return out;
  }, [actionNames, id, showToast]);

  const initialUi = useMemo(() => readUi(id), [id]);
  const onUiChange = useCallback(
    (ui: Record<string, unknown>) => {
      try {
        localStorage.setItem(uiKey(id), JSON.stringify(ui));
      } catch {
        /* storage full or blocked: state stays in memory */
      }
    },
    [id],
  );
  const onMessage = useCallback(
    (text: string) => {
      const conv = useArtifacts.getState().byId[id]?.conversationId;
      if (conv) void useChat.getState().send(conv, text);
    },
    [id],
  );
  const onError = useCallback((errs: Issue[]) => setIssues(errs), []);
  const onActionError = useCallback((msg: string) => showToast(msg), [showToast]);

  if (!artifact) {
    return (
      <div className={`py-6 text-center text-[13px] ${error ? "text-muted" : "shimmer"} ${className}`}>
        {error ? (/not found|404/i.test(error) ? "This artifact no longer exists." : "Couldn’t load this artifact.") : "Opening…"}
      </div>
    );
  }

  return (
    <ToolScope group={artifact.id} describe={artifact.title} className={`relative min-w-0 ${className}`}>
      {owner && <ArtifactTools artifact={artifact} />}
      <div data-bits-genui="">
        <GenBoundary resetKey={`${artifact.version}`} fallback={<JsonPreview value={{ program: artifact.program, data: artifact.data }} label="Couldn’t draw this artifact — raw view" />}>
          <Renderer
            components={catalog}
            response={artifact.program}
            isStreaming={false}
            data={artifact.data}
            tools={tools}
            onMessage={onMessage}
            onError={onError}
            onActionError={onActionError}
            initialUi={initialUi}
            onUiChange={onUiChange}
          />
        </GenBoundary>
      </div>
      <IssuesNote issues={issues} />
      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="pointer-events-none sticky bottom-3 z-10 mx-auto mt-3 flex w-fit max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] text-ink-2 shadow-float"
          >
            <CircleAlert size={13} className="flex-none text-danger" />
            <span className="truncate">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </ToolScope>
  );
}
