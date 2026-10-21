import type {
  Approval,
  Artifact,
  ArtifactActivity,
  ArtifactMeta,
  Conversation,
  MemoryOverview,
  Message,
  SendMessageBody,
  SendMessageResult,
  Turn,
  VoiceConfig,
} from "@bits/protocol";
import { DEMO } from "./lib/demo";
import { demoApi } from "@bits-demo";

/** Optional bearer token (BITS_TOKEN). Picked up from `?token=` once, then remembered. */
function readToken(): string | null {
  try {
    const fromUrl = new URLSearchParams(location.search).get("token");
    if (fromUrl) localStorage.setItem("bits.token", fromUrl);
    return fromUrl ?? localStorage.getItem("bits.token");
  } catch {
    return null;
  }
}
// The demo never reads or sends a token.
export const token = DEMO ? null : readToken();

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  /** True when the daemon itself is unreachable (vs. a real error response). */
  get offline() {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

type Listener = (online: boolean) => void;
const reachability = new Set<Listener>();
/** Subscribe to "did the last request reach the daemon?" signals. */
export function onReachability(fn: Listener) {
  reachability.add(fn);
  return () => reachability.delete(fn);
}
function report(online: boolean) {
  for (const fn of reachability) fn(online);
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  if (DEMO) throw new ApiError(0, "The demo has no daemon"); // never reached: demo calls go to demoApi
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, ...init });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    report(false);
    throw new ApiError(0, "Bits is not reachable");
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    report(false);
    throw new ApiError(res.status, "Bits is not reachable");
  }
  report(true);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.error ?? j.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await res.json()) as T;
  return (await res.blob()) as T;
}

/** The daemon also returns `dataVersion` (bumped on every data change). */
export type FullArtifact = Artifact & { dataVersion?: number };

export interface MessagesPage {
  messages: Message[];
  lastSeq: number;
  turn: Turn | null;
}

const liveApi = {
  health: () => request<{ ok: true; version: string; model: string }>("GET", "/health"),

  conversations: () => request<Conversation[]>("GET", "/conversations"),
  createConversation: (title?: string) => request<Conversation>("POST", "/conversations", { title }),
  messages: (id: string, after = 0, limit?: number) =>
    request<MessagesPage>(
      "GET",
      `/conversations/${encodeURIComponent(id)}/messages?after=${after}${limit ? `&limit=${limit}` : ""}`,
    ),
  send: (conversationId: string, body: SendMessageBody) =>
    request<SendMessageResult>("POST", `/conversations/${encodeURIComponent(conversationId)}/messages`, body),
  cancel: (conversationId: string) => request<unknown>("POST", `/conversations/${encodeURIComponent(conversationId)}/cancel`),

  approvals: (status = "pending") => request<Approval[]>("GET", `/approvals?status=${status}`),
  decide: (id: string, decision: "approve" | "deny" | "always") =>
    request<Approval>("POST", `/approvals/${encodeURIComponent(id)}`, { decision }),

  memory: () => request<MemoryOverview>("GET", "/memory"),
  saveProfile: (content: string) => request<{ ok: true }>("PUT", "/memory/profile", { content }),
  log: (month: string) => request<{ content: string }>("GET", `/memory/log/${encodeURIComponent(month)}`),
  skill: (name: string) =>
    request<{ name: string; description: string; content: string }>("GET", `/skills/${encodeURIComponent(name)}`),
  runRoutine: (name: string) => request<{ turnId: string }>("POST", `/routines/${encodeURIComponent(name)}/run`),
  setRoutine: (name: string, enabled: boolean) =>
    request<{ ok: true }>("PATCH", `/routines/${encodeURIComponent(name)}`, { enabled }),

  artifacts: () => request<ArtifactMeta[]>("GET", "/artifacts"),
  artifact: (id: string) => request<FullArtifact>("GET", `/artifacts/${encodeURIComponent(id)}`),
  artifactActivity: (id: string) => request<ArtifactActivity[]>("GET", `/artifacts/${encodeURIComponent(id)}/activity`),
  runAction: (id: string, action: string, input: unknown, by: "person" | "agent") =>
    request<{ data: Record<string, unknown>; dataVersion?: number }>(
      "POST",
      `/artifacts/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
      { input: input ?? {}, by },
    ),

  voiceConfig: () => request<VoiceConfig>("GET", "/voice/config"),
  transcribe: (audio: Blob) => {
    const form = new FormData();
    const ext = audio.type.includes("ogg") ? "ogg" : audio.type.includes("wav") ? "wav" : audio.type.includes("mp4") ? "m4a" : "webm";
    form.append("audio", audio, `utterance.${ext}`);
    return request<{ text: string }>("POST", "/voice/transcribe", form);
  },
  speak: (text: string, signal?: AbortSignal) => request<Blob>("POST", "/voice/speak", { text }, { signal }),
};

export type Api = typeof liveApi;

/** The daemon API, or an in-memory stand-in when built with VITE_BITS_DEMO=1. */
export const api: Api = import.meta.env.VITE_BITS_DEMO === "1" ? demoApi : liveApi;

export function eventsUrl() {
  return token ? `/api/events?token=${encodeURIComponent(token)}` : "/api/events";
}
