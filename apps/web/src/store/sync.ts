import type { ServerEvent } from "@bits/protocol";
import { eventsUrl, onReachability } from "../api";
import { useChat } from "./chat";

type Handler = (ev: ServerEvent) => void;
const handlers = new Set<Handler>();
const reconnectHooks = new Set<() => void>();

/** Listen to every server event (used by memory + voice). */
export function onServerEvent(fn: Handler) {
  handlers.add(fn);
  return () => void handlers.delete(fn);
}
/** Run after every (re)connect — a good moment to refetch anything that may be stale. */
export function onReconnect(fn: () => void) {
  reconnectHooks.add(fn);
  return () => void reconnectHooks.delete(fn);
}

let started = false;

/** Open the single SSE connection with reconnect + exponential backoff. Idempotent. */
export function startSync() {
  if (started) return;
  started = true;

  let es: EventSource | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offlineTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const chat = useChat.getState;

  const markOffline = () => {
    // Small grace period so quick reconnects don't flash the banner.
    if (offlineTimer) return;
    offlineTimer = setTimeout(() => {
      if (chat().connection !== "online" || !es || es.readyState !== EventSource.OPEN) chat().setConnection("offline");
    }, 1200);
  };
  const markOnline = () => {
    clearTimeout(offlineTimer);
    offlineTimer = undefined;
    chat().setConnection("online");
  };

  // The daemon pings periodically; if we hear nothing for a long time, assume the link is dead.
  const kick = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      es?.close();
      schedule();
    }, 45_000);
  };

  const refetchAll = () => {
    const s = chat();
    s.loadConversations().catch(() => {});
    s.loadApprovals().catch(() => {});
    for (const [id, c] of Object.entries(s.convs)) if (c.loaded) void s.fetchAfter(id);
    if (!s.convs[s.activeId]?.loaded) void s.fetchAfter(s.activeId);
    for (const fn of reconnectHooks) fn();
  };

  const connect = () => {
    clearTimeout(timer);
    es?.close();
    es = new EventSource(eventsUrl());
    es.onopen = () => {
      attempt = 0;
      markOnline();
      kick();
      refetchAll();
    };
    es.onmessage = (msg) => {
      kick();
      let ev: ServerEvent;
      try {
        ev = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (chat().connection !== "online") markOnline();
      chat().applyEvent(ev);
      for (const fn of handlers) fn(ev);
    };
    es.onerror = () => {
      es?.close();
      markOffline();
      schedule();
    };
  };

  const schedule = () => {
    clearTimeout(timer);
    const delay = Math.min(10_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
    attempt++;
    timer = setTimeout(connect, delay);
  };

  // If a REST call reaches the daemon while we're disconnected, reconnect right away.
  onReachability((online) => {
    if (online && (!es || es.readyState === EventSource.CLOSED)) {
      attempt = 0;
      connect();
    } else if (!online) markOffline();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (!es || es.readyState === EventSource.CLOSED)) {
      attempt = 0;
      connect();
    }
  });

  connect();
}
