import { create } from "zustand";
import type { MemoryOverview } from "@bits/protocol";
import { api } from "../api";
import { onReconnect, onServerEvent } from "./sync";

interface MemoryState {
  data: MemoryOverview | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  saveProfile: (content: string) => Promise<void>;
  toggleRoutine: (name: string, enabled: boolean) => Promise<void>;
  runRoutine: (name: string) => Promise<void>;
}

let wired = false;

export const useMemory = create<MemoryState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,
  async load() {
    if (!wired) {
      wired = true;
      onServerEvent((ev) => ev.type === "memory" && void get().load());
      onReconnect(() => void get().load());
    }
    set({ loading: !get().data });
    try {
      const data = await api.memory();
      set({ data, loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },
  async saveProfile(content) {
    await api.saveProfile(content);
    set((s) => (s.data ? { data: { ...s.data, profile: content } } : {}));
  },
  async toggleRoutine(name, enabled) {
    const prev = get().data;
    set((s) =>
      s.data ? { data: { ...s.data, routines: s.data.routines.map((r) => (r.name === name ? { ...r, enabled } : r)) } } : {},
    );
    try {
      await api.setRoutine(name, enabled);
    } catch (err) {
      set({ data: prev });
      throw err;
    }
  },
  async runRoutine(name) {
    await api.runRoutine(name);
  },
}));
