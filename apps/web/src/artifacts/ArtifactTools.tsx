import { useTool } from "@agentable-ui/react";
import type { ArtifactAction } from "@bits/protocol";
import type { FullArtifact } from "../api";
import { toolName, useArtifacts } from "../store/artifacts";

const EMPTY_SCHEMA = { type: "object", properties: {} };

function ActionTool({ artifact, name, action }: { artifact: FullArtifact; name: string; action: ArtifactAction }) {
  useTool({
    name: toolName(artifact.id, name),
    description: `${action.description} (in "${artifact.title}")`,
    inputSchema: (action.input ?? EMPTY_SCHEMA) as Record<string, unknown>,
    confirm: action.confirm ? `Let a browser agent run “${name}” in “${artifact.title}”?` : false,
    output: { maxChars: 2000 },
    execute: async (args) => {
      const data = await useArtifacts.getState().run(artifact.id, name, args, "agent");
      return { ok: true, data };
    },
  });
  return null;
}

function StateTool({ artifact }: { artifact: FullArtifact }) {
  useTool({
    name: toolName(artifact.id, "state"),
    description: `Read the current data and available actions of "${artifact.title}" (${artifact.kind}).`,
    annotations: { readOnlyHint: true },
    cache: false,
    output: { maxChars: 4000 },
    execute: () => {
      const a = useArtifacts.getState().byId[artifact.id] ?? artifact;
      return {
        title: a.title,
        data: a.data,
        actions: Object.fromEntries(Object.entries(a.actions).map(([k, v]) => [k, v.description])),
      };
    },
  });
  return null;
}

/** Registers one WebMCP tool per declared action, plus a read-only `<short>_state`. */
export function ArtifactTools({ artifact }: { artifact: FullArtifact }) {
  return (
    <>
      <StateTool artifact={artifact} />
      {Object.entries(artifact.actions ?? {}).map(([name, action]) => (
        // Keyed by version too, so a changed schema/description re-registers.
        <ActionTool key={`${name}:${artifact.version}`} artifact={artifact} name={name} action={action} />
      ))}
    </>
  );
}
