import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "./config.ts";
import type { ToolDef } from "./agent/tools.ts";

// Connectors are MCP servers, configured in ~/.bits/connectors.json:
// {
//   "servers": {
//     "github":   { "url": "https://api.githubcopilot.com/mcp/", "headers": { "Authorization": "Bearer …" } },
//     "calendar": { "command": "npx", "args": ["-y", "some-calendar-mcp"], "env": { "TOKEN": "…" } }
//   }
// }
// Tools marked readOnlyHint run freely; destructiveHint always asks; everything else is auto-reviewed.

type ServerConfig =
  | { url: string; headers?: Record<string, string>; disabled?: boolean }
  | { command: string; args?: string[]; env?: Record<string, string>; disabled?: boolean };

export interface ConnectorStatus {
  name: string;
  ok: boolean;
  tools: number;
  error?: string;
}

const clients: Client[] = [];
export const connectorStatus: ConnectorStatus[] = [];

const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

export async function loadConnectors(): Promise<ToolDef[]> {
  if (!fs.existsSync(config.paths.connectors)) {
    fs.writeFileSync(config.paths.connectors, JSON.stringify({ servers: {} }, null, 2) + "\n");
    return [];
  }
  let servers: Record<string, ServerConfig> = {};
  try {
    servers = JSON.parse(fs.readFileSync(config.paths.connectors, "utf8")).servers ?? {};
  } catch (e) {
    console.error("[bits] connectors.json is not valid JSON:", e);
    return [];
  }

  const defs: ToolDef[] = [];
  await Promise.all(
    Object.entries(servers)
      .filter(([, s]) => !s.disabled)
      .map(async ([name, s]) => {
        try {
          const client = new Client({ name: "bits", version: config.version });
          const transport =
            "url" in s
              ? new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: s.headers ?? {} } })
              : new StdioClientTransport({ command: s.command, args: s.args ?? [], env: { ...(process.env as Record<string, string>), ...(s.env ?? {}) } });
          await client.connect(transport);
          clients.push(client);
          const { tools } = await client.listTools();
          for (const t of tools.slice(0, 100)) {
            const ann = (t.annotations ?? {}) as { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
            defs.push({
              name: `mcp__${clean(name)}__${clean(t.name)}`.slice(0, 64),
              description: `[${name}] ${t.description ?? t.name}`.slice(0, 1000),
              input: { jsonSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} } },
              risk: ann.readOnlyHint ? "read" : ann.destructiveHint ? "destructive" : "external",
              activity: () => `Using ${name}`,
              async execute(input) {
                const res = await client.callTool({ name: t.name, arguments: (input ?? {}) as Record<string, unknown> });
                const text = (res.content as any[] | undefined)
                  ?.map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
                  .join("\n");
                if (res.isError) throw new Error(text || "Connector error");
                const out = res.structuredContent ?? text ?? res;
                return typeof out === "string" && out.length > 20_000 ? out.slice(0, 20_000) + "…" : out;
              },
            });
          }
          connectorStatus.push({ name, ok: true, tools: tools.length });
        } catch (e: any) {
          connectorStatus.push({ name, ok: false, tools: 0, error: String(e?.message ?? e) });
          console.error(`[bits] connector ${name} failed:`, e?.message ?? e);
        }
      }),
  );
  return defs;
}

export async function closeConnectors() {
  await Promise.allSettled(clients.map((c) => c.close()));
}
