import type { ToolCallPart } from "@bits/protocol";
import { GenUI } from "./GenUI";

/**
 * THE single boundary for generative UI. Every place that renders a `render_ui` tool call goes
 * through here, so the renderer behind it can be swapped (e.g. for Agentable) without touching
 * the thread, overlay or fixtures.
 */
export function GenUIBlock({ part, onAction }: { part: ToolCallPart; onAction?: (message: string) => void }) {
  return <GenUI input={part.input} onAction={onAction} />;
}
