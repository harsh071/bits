// A minimal Chrome DevTools Protocol client over Node's built-in WebSocket. No dependencies.
// Adapted from the CDP client in RUI (Interfaces for Humans).
//
// We connect to the browser-level endpoint and attach to pages with `flatten: true`.
// Each attached page gets its own sessionId on the one socket, so Bits can follow new tabs
// without opening more connections, and other tools can attach to the same Chrome.

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export type CdpEventHandler = (params: any, sessionId: string | undefined) => void;

/** The browser-level WebSocket URL for a Chrome listening on `port`. */
export async function browserEndpoint(port: number, timeoutMs = 1500): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Chrome /json/version returned ${res.status}`);
  const v = (await res.json()) as { webSocketDebuggerUrl: string };
  return v.webSocketDebuggerUrl;
}

export class CdpConnection {
  #socket: WebSocket;
  #nextId = 1;
  #pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>();
  #handlers = new Map<string, Set<CdpEventHandler>>();
  #closed = false;
  #onClose: (() => void)[] = [];

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (e) => this.#onMessage(String(e.data)));
    // A socket that dies must fail every in-flight command instead of hanging.
    socket.addEventListener("close", () => {
      this.#closed = true;
      for (const p of this.#pending.values()) p.reject(new Error(`Chrome connection closed during ${p.method}`));
      this.#pending.clear();
      for (const f of this.#onClose) f();
    });
  }

  static async open(url: string): Promise<CdpConnection> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`cannot open CDP socket ${url}`)), { once: true });
    });
    return new CdpConnection(socket);
  }

  get closed() {
    return this.#closed;
  }

  onClose(f: () => void) {
    this.#onClose.push(f);
  }

  #onMessage(raw: string) {
    const msg = JSON.parse(raw) as CdpMessage;
    if (typeof msg.id === "number") {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result ?? {});
      return;
    }
    if (msg.method) for (const h of this.#handlers.get(msg.method) ?? []) h(msg.params ?? {}, msg.sessionId);
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.#closed) return Promise.reject(new Error(`Chrome connection closed; cannot send ${method}`));
    const id = this.#nextId++;
    const payload: CdpMessage = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.#socket.send(JSON.stringify(payload));
    });
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on(method: string, handler: CdpEventHandler): () => void {
    let set = this.#handlers.get(method);
    if (!set) this.#handlers.set(method, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  close() {
    this.#closed = true;
    this.#socket.close();
  }
}

/** A connection bound to one page's flattened session. */
export interface PageSession {
  targetId: string;
  sessionId: string;
  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Events for this page only. */
  on(method: string, handler: (params: any) => void): () => void;
}

export async function attach(conn: CdpConnection, targetId: string): Promise<PageSession> {
  const { sessionId } = await conn.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  return {
    targetId,
    sessionId,
    send: (method, params) => conn.send(method, params ?? {}, sessionId),
    on: (method, handler) => conn.on(method, (p, sid) => sid === sessionId && handler(p)),
  };
}
