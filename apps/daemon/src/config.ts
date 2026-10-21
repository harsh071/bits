import os from "node:os";
import path from "node:path";

function expandHome(p: string) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

const home = path.resolve(expandHome(process.env.BITS_HOME ?? "~/.bits"));

export const config = {
  version: "0.1.0",
  home,
  port: Number(process.env.BITS_PORT ?? 7077),
  host: process.env.BITS_HOST ?? "127.0.0.1",
  token: process.env.BITS_TOKEN || null,
  paths: {
    db: path.join(home, "state.db"),
    memory: path.join(home, "memory"),
    profile: path.join(home, "memory", "profile.md"),
    log: path.join(home, "memory", "log"),
    skills: path.join(home, "skills"),
    routines: path.join(home, "routines"),
    workspace: path.join(home, "workspace"),
    connectors: path.join(home, "connectors.json"),
  },
  model: process.env.BITS_MODEL ?? defaultModel(),
  fastModel: process.env.BITS_FAST_MODEL ?? process.env.BITS_MODEL ?? defaultFastModel(),
  /** Max model↔tool steps in one turn before Bits pauses and reports back. */
  maxSteps: Number(process.env.BITS_MAX_STEPS ?? 40),
  /** Summarize a conversation this long after the turn ends (the provider cache is still warm). */
  compactAfterMs: Number(process.env.BITS_COMPACT_AFTER_MS ?? 10 * 60_000),
  /** Only summarize if the prompt is at least this big (rough token estimate). */
  compactMinTokens: Number(process.env.BITS_COMPACT_MIN_TOKENS ?? 60_000),
  webDist: process.env.BITS_WEB_DIST ?? path.resolve(import.meta.dirname, "../../web/dist"),
  voice: {
    stt: (process.env.BITS_STT ?? (process.env.OPENAI_API_KEY ? "openai" : "browser")) as "openai" | "browser",
    tts: (process.env.BITS_TTS ??
      (process.env.CARTESIA_API_KEY ? "cartesia" : process.env.OPENAI_API_KEY ? "openai" : "browser")) as
      | "openai"
      | "cartesia"
      | "browser",
  },
};

function defaultModel() {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic:claude-sonnet-5-5";
  if (process.env.OPENAI_API_KEY) return "openai:gpt-5.5";
  return "local:qwen3:14b";
}

function defaultFastModel() {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic:claude-haiku-5-5";
  if (process.env.OPENAI_API_KEY) return "openai:gpt-5.4-mini";
  return defaultModel();
}
