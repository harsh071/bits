import { create } from "zustand";
import type { AddConnectorBody, ConnectorsOverview } from "@bits/protocol";
import { api } from "../api";
import { onReconnect, onServerEvent } from "./sync";

interface ConnectorsState {
  data: ConnectorsOverview | null;
  error: string | null;
  load: () => Promise<void>;
  add: (body: AddConnectorBody) => Promise<void>;
}

let wired = false;

export const useConnectors = create<ConnectorsState>()((set, get) => ({
  data: null,
  error: null,
  async load() {
    if (!wired) {
      wired = true;
      onServerEvent((ev) => ev.type === "connectors" && void get().load());
      onReconnect(() => void get().load());
    }
    try {
      set({ data: await api.connectors(), error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
  async add(body) {
    await api.addConnector(body);
    await get().load();
  },
}));
