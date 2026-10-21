import fs from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { config } from "../config.ts";
import { resolveModel } from "../models.ts";
import { textOf, type Store } from "../store.ts";
import type { ToolDef } from "./tools.ts";

// The Sentinel replaces "approve every step" with steering:
// most calls just run, risky ones get a quick independent review, and only what the
// reviewer can't justify from YOUR words waits for you.
//
// Decision order (first match wins):
//   1. policy deny  →  blocked
//   2. policy ask   →  ask you   (ask wins over allow when both match)
//   3. policy allow →  run
//   4. risk read/write → run
//   5. risk destructive → ask you
//   6. risk external → auto-review: allowed only if the user's own recent messages clearly asked for it.
//      The reviewer never sees tool outputs or web content, so injected instructions can't approve actions.

export type Verdict = { action: "run" } | { action: "ask"; reason: string } | { action: "deny"; reason: string };

interface Policy {
  allow: string[];
  ask: string[];
  deny: string[];
}

const policyFile = path.join(config.home, "policy.json");

export function loadPolicy(): Policy {
  try {
    const p = JSON.parse(fs.readFileSync(policyFile, "utf8"));
    return { allow: p.allow ?? [], ask: p.ask ?? [], deny: p.deny ?? [] };
  } catch {
    return { allow: [], ask: [], deny: [] };
  }
}

export function alwaysAllow(toolName: string) {
  const p = loadPolicy();
  if (!p.allow.includes(toolName)) p.allow.push(toolName);
  fs.writeFileSync(policyFile, JSON.stringify(p, null, 2) + "\n");
}

const glob = (pattern: string, name: string) =>
  new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(name);

export async function review(tool: ToolDef, input: unknown, store: Store, conversationId: string): Promise<Verdict> {
  const policy = loadPolicy();
  if (policy.deny.some((p) => glob(p, tool.name))) return { action: "deny", reason: "Blocked by your policy." };
  if (policy.ask.some((p) => glob(p, tool.name))) return { action: "ask", reason: "Your policy asks before this tool runs." };
  if (policy.allow.some((p) => glob(p, tool.name))) return { action: "run" };
  if (tool.risk === "read" || tool.risk === "write") return { action: "run" };
  if (tool.risk === "destructive") return { action: "ask", reason: "This is hard to undo." };

  const userWords = store
    .lastMessages(conversationId, 30)
    .filter((m) => m.role === "user")
    .slice(-6)
    .map((m) => `- ${textOf(m.parts).slice(0, 600)}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model: resolveModel(config.fastModel),
      instructions: `You are a safety reviewer for a personal AI agent. Decide whether the agent may perform an action WITHOUT interrupting the user.
Approve ("allow") only when the action is low-risk and clearly within what the user asked for in their own words below.
Ask the user ("ask") when the action could: spend money, send messages or emails as the user, delete or overwrite data outside the agent's workspace, change system settings, install software globally, expose private data, or when it isn't clearly requested.
Reply with JSON only: {"verdict":"allow"|"ask","reason":"<one short sentence for the user>"}`,
      prompt: `The user's recent messages:\n${userWords || "(none)"}\n\nProposed action: ${tool.name}\nTool description: ${tool.description.slice(0, 300)}\nInput: ${JSON.stringify(input).slice(0, 2000)}`,
      maxOutputTokens: 200,
    });
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (json.verdict === "allow") return { action: "run" };
    return { action: "ask", reason: String(json.reason || "Needs your OK.") };
  } catch {
    return { action: "ask", reason: "The safety check couldn't decide, so it's asking you." };
  }
}
