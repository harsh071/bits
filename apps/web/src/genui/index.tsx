import { useCallback, useState } from "react";
import { motion } from "motion/react";
import { Renderer } from "@agentable-ui/genui";
import type { PresentInput, ToolCallPart, ToolResultPart } from "@bits/protocol";
import { GenUI, JsonPreview } from "./GenUI";
import { GenBoundary, IssuesNote, type Issue } from "./Boundary";
import { catalog } from "./catalog";
import { ArtifactEmbed, ArtifactPending } from "../artifacts/ArtifactEmbed";
import { ActivityChip } from "../components/Activity";

interface Props {
  part: ToolCallPart;
  /** The matching (latest) tool result, if any. */
  result?: ToolResultPart;
  /** Send text back as the user's next message (@Say, legacy action buttons). */
  onAction?: (message: string) => void;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** An inline, one-off Agentable view from the `present` tool. */
export function PresentBlock({ input, onAction }: { input: PresentInput; onAction?: (message: string) => void }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const onError = useCallback((errs: Issue[]) => setIssues(errs), []);
  const onMessage = useCallback((text: string) => onAction?.(text), [onAction]);
  const program = str(input?.program);
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
      {input?.title && <div className="mb-2.5 font-serif text-[24px] leading-tight tracking-[-0.01em] text-ink">{input.title}</div>}
      <div data-bits-genui="">
        <GenBoundary resetKey={program} fallback={<JsonPreview value={input} label="Couldn’t draw this view — here’s the program" />}>
          <Renderer components={catalog} response={program} isStreaming={false} onMessage={onMessage} onError={onError} />
        </GenBoundary>
      </div>
      <IssuesNote issues={issues} />
    </motion.div>
  );
}

function resultId(result?: ToolResultPart): string | undefined {
  const o = result?.output;
  if (o && typeof o === "object" && typeof (o as { id?: unknown }).id === "string") return (o as { id: string }).id;
  return undefined;
}

/**
 * THE single boundary for generative UI in a conversation. Every place that renders a UI-producing
 * tool call (thread, overlay, fixtures) goes through here.
 *   present                          → Agentable <Renderer> over the program
 *   artifact_create / artifact_update → a live, embedded artifact
 *   render_ui (legacy)               → the old JSON node renderer
 */
export function GenUIBlock({ part, result, onAction }: Props) {
  const input = (part.input ?? {}) as Record<string, unknown>;
  // A failed call is just a step the agent will retry: show it as a quiet chip.
  if (result?.isError) return <ActivityChip call={{ id: part.toolCallId, name: part.toolName, input: part.input, result }} />;

  switch (part.toolName) {
    case "present":
      return <PresentBlock input={input as unknown as PresentInput} onAction={onAction} />;
    case "artifact_create": {
      const id = resultId(result);
      return id ? <ArtifactEmbed id={id} fallbackTitle={str(input.title)} /> : <ArtifactPending title={str(input.title)} />;
    }
    case "artifact_update": {
      const id = str(input.id) || resultId(result);
      return id ? <ArtifactEmbed id={id} updated /> : <ArtifactPending title={str(input.title)} />;
    }
    default:
      return <GenUI input={part.input} onAction={onAction} />;
  }
}
