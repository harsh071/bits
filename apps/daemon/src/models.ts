import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Model ids are "<provider>:<model>":
//   anthropic:claude-sonnet-5-5 | openai:gpt-5.5 | local:qwen3:14b (Ollama/LM Studio) | gateway:anthropic/claude-sonnet-5-5
let override: ((id: string) => LanguageModel) | null = null;
/** Tests (and future plugins) can supply models directly. */
export function setModelResolver(fn: ((id: string) => LanguageModel) | null) {
  override = fn;
}

export function resolveModel(id: string): LanguageModel {
  if (override) return override(id);
  const i = id.indexOf(":");
  const provider = i === -1 ? "gateway" : id.slice(0, i);
  const name = i === -1 ? id : id.slice(i + 1);
  switch (provider) {
    case "anthropic":
      return createAnthropic()(name);
    case "openai":
      return createOpenAI()(name);
    case "local":
      return createOpenAICompatible({
        name: "local",
        baseURL: process.env.BITS_LOCAL_BASE_URL ?? "http://localhost:11434/v1",
        apiKey: process.env.BITS_LOCAL_API_KEY,
      })(name);
    case "gateway":
      return name; // AI SDK resolves plain strings through the Vercel AI Gateway
    default:
      throw new Error(`Unknown model provider "${provider}" in "${id}"`);
  }
}

export function isAnthropic(id: string) {
  return id.startsWith("anthropic:") || id.startsWith("gateway:anthropic/");
}
