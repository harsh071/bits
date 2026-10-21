import { create } from "zustand";
import type { ArtifactActivity, ArtifactMeta } from "@bits/protocol";
import { api, type FullArtifact } from "../api";
import { onReconnect, onServerEvent } from "./sync";

interface ArtifactState {
  list: ArtifactMeta[] | null;
  listError: string | null;
  byId: Record<string, FullArtifact | undefined>;
  errors: Record<string, string | undefined>;
  activity: Record<string, ArtifactActivity[] | undefined>;
  /** Artifact open in the chat side panel. */
  panelId: string | null;
  /** Artifact open on the Artifacts page (null = the shelf). */
  pageId: string | null;

  loadList: () => Promise<void>;
  load: (id: string) => Promise<void>;
  loadActivity: (id: string) => Promise<void>;
  run: (id: string, action: string, input: unknown, by: "person" | "agent") => Promise<Record<string, unknown>>;
  openPanel: (id: string | null) => void;
  openPage: (id: string | null) => void;
}

const inflight = new Map<string, Promise<void>>();
const again = new Set<string>();

export const useArtifacts = create<ArtifactState>()((set, get) => ({
  list: null,
  listError: null,
  byId: {},
  errors: {},
  activity: {},
  panelId: null,
  pageId: null,

  async loadList() {
    try {
      const list = await api.artifacts();
      set({ list, listError: null });
    } catch (err) {
      set({ listError: (err as Error).message });
    }
  },

  load(id) {
    // Coalesce: one request in flight per artifact, plus at most one follow-up.
    const running = inflight.get(id);
    if (running) {
      again.add(id);
      return running;
    }
    const p = (async () => {
      try {
        do {
          again.delete(id);
          const a = await api.artifact(id);
          set((s) => ({ byId: { ...s.byId, [id]: a }, errors: { ...s.errors, [id]: undefined } }));
        } while (again.has(id));
      } catch (err) {
        set((s) => ({ errors: { ...s.errors, [id]: (err as Error).message } }));
      } finally {
        inflight.delete(id);
      }
    })();
    inflight.set(id, p);
    return p;
  },

  async loadActivity(id) {
    try {
      const items = await api.artifactActivity(id);
      set((s) => ({ activity: { ...s.activity, [id]: items } }));
    } catch {
      /* the feed is best-effort */
    }
  },

  async run(id, action, input, by) {
    const res = await api.runAction(id, action, input, by);
    set((s) => {
      const cur = s.byId[id];
      if (!cur) return {};
      return { byId: { ...s.byId, [id]: { ...cur, data: res.data, dataVersion: res.dataVersion ?? cur.dataVersion } } };
    });
    if (get().activity[id]) void get().loadActivity(id);
    return res.data;
  },

  openPanel: (panelId) => set({ panelId }),
  openPage: (pageId) => set({ pageId }),
}));

// ---------- live sync ----------
onServerEvent((ev) => {
  const s = useArtifacts.getState();
  if (ev.type === "artifacts") {
    if (s.list) void s.loadList();
  } else if (ev.type === "artifact") {
    const cur = s.byId[ev.id];
    if (cur && (cur.version !== ev.version || (cur.dataVersion ?? -1) !== ev.dataVersion)) void s.load(ev.id);
    if (s.activity[ev.id]) void s.loadActivity(ev.id);
    if (s.list) void s.loadList();
  }
});
onReconnect(() => {
  const s = useArtifacts.getState();
  if (s.list) void s.loadList();
  for (const id of Object.keys(s.byId)) void s.load(id);
});

// ---------- which mounted view owns the WebMCP tools ----------
// The same artifact can be on screen twice (chat embed + side panel). Only the first mounted
// instance registers its tools; when it unmounts, ownership passes to the next one.
const owners = new Map<string, string[]>();
const ownerListeners = new Set<() => void>();
export function claimArtifact(id: string, instance: string) {
  owners.set(id, [...(owners.get(id) ?? []), instance]);
  ownerListeners.forEach((fn) => fn());
  return () => {
    owners.set(id, (owners.get(id) ?? []).filter((x) => x !== instance));
    ownerListeners.forEach((fn) => fn());
  };
}
export function isArtifactOwner(id: string, instance: string) {
  return owners.get(id)?.[0] === instance;
}
export function onOwnersChange(fn: () => void) {
  ownerListeners.add(fn);
  return () => void ownerListeners.delete(fn);
}

// ---------- helpers ----------

/** WebMCP-safe short name: id without its random suffix, snake_cased. */
export function shortName(id: string) {
  const s = id
    .replace(/-[a-z0-9]{6}$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return /^[a-z]/.test(s) ? s : `a_${s}`;
}

/** `${short}_${suffix}`, trimmed so the whole name fits 64 chars of [a-zA-Z0-9_]. */
export function toolName(id: string, suffix: string) {
  const tail = suffix.replace(/[^a-zA-Z0-9_]/g, "_");
  const room = Math.max(1, 64 - tail.length - 1);
  return `${shortName(id).slice(0, room).replace(/_+$/, "")}_${tail}`.slice(0, 64);
}
