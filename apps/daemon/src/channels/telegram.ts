import crypto from "node:crypto";
import type { Approval, Message, ServerEvent, TelegramStatus } from "@bits/protocol";
import { bus } from "../bus.ts";
import { config } from "../config.ts";
import { secrets } from "../secrets.ts";
import { isTerminal, textOf } from "../store.ts";
import { speechToText } from "../voice.ts";
import type { Runtime } from "../agent/runtime.ts";

// Telegram channel: talk to Bits from your phone.
//
// - You make a bot with @BotFather and paste its token; it goes in the vault, never in a file or the model.
// - The daemon long-polls getUpdates, so nothing has to reach this machine from the internet.
// - Pairing: Bits shows a t.me/<bot>?start=<code> link. The first private chat that opens it becomes the owner;
//   every other chat is ignored, because anyone can find and message a bot.
// - Messages from the paired chat go to the Home conversation as your own words (source "telegram").
// - Replies go back when a turn started from Telegram or by a routine finishes, so a morning routine lands on
//   your phone. Approvals for those turns come with Approve / Deny / Always buttons.

const TOKEN = "channel:telegram";
const K = {
  chat: "telegram.chat",
  offset: "telegram.offset",
  code: "telegram.code",
  deliver: (conversationId: string) => `telegram.deliver.${conversationId}`,
  approval: (id: string) => `telegram.approval.${id}`,
};
const HOME = "home";
const MAX_LEN = 4000; // Telegram allows 4096 characters per message
const SHOWS_IN_APP: Record<string, string> = { present: "a view", artifact_create: "an artifact", artifact_update: "an artifact" };

type Chat = { id: number; name: string };
type TgMessage = {
  message_id: number;
  chat: { id: number; type: string; first_name?: string; username?: string };
  text?: string;
  voice?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; mime_type?: string };
};
type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

class TelegramError extends Error {
  code: number;
  constructor(code: number, description: string) {
    super(description);
    this.code = code;
  }
}

export class Telegram {
  private runtime: Runtime;
  private api: string;
  private bot: string | null = null;
  private error: string | null = null;
  private ctrl: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastTyping = new Map<string, number>();
  /** Resolves when the poll loop exits (tests wait on it). */
  private loop: Promise<void> = Promise.resolve();

  constructor(runtime: Runtime, opts: { api?: string } = {}) {
    this.runtime = runtime;
    this.api = (opts.api ?? process.env.BITS_TELEGRAM_API ?? "https://api.telegram.org").replace(/\/$/, "");
  }

  private get store() {
    return this.runtime.store;
  }

  // ---------- lifecycle ----------

  async start() {
    if (!this.token()) return;
    this.unsubscribe ??= bus.subscribe((e) => this.onEvent(e).catch((err) => console.error("[bits] telegram:", err.message)));
    try {
      const me = await this.call<{ username: string }>("getMe");
      this.bot = me.username;
      this.error = null;
    } catch (err: any) {
      this.error = err instanceof TelegramError && err.code === 401 ? "Telegram rejected the bot token." : `Can't reach Telegram: ${err.message}`;
      bus.emit({ type: "channels" });
      if (err instanceof TelegramError) return; // a bad token won't fix itself
    }
    if (!this.code()) this.store.kvSet(K.code, crypto.randomBytes(9).toString("base64url"));
    this.ctrl = new AbortController();
    this.loop = this.poll(this.ctrl.signal);
    bus.emit({ type: "channels" });
  }

  async stop() {
    this.ctrl?.abort();
    this.ctrl = null;
    await this.loop;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Checks the token with Telegram, stores it, and starts a fresh pairing. */
  async setup(token: string) {
    token = token.trim();
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("That doesn't look like a bot token. It looks like 123456:ABC-DEF…");
    const r = await fetch(`${this.api}/bot${token}/getMe`).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean } | null;
    if (!j?.ok) throw new Error(r ? "Telegram didn't accept that token." : "Can't reach Telegram.");
    await this.stop();
    secrets.set(TOKEN, token);
    this.forgetPairing();
    await this.start();
    return this.status();
  }

  async remove() {
    await this.stop();
    secrets.delete(TOKEN);
    this.forgetPairing();
    this.bot = null;
    this.error = null;
    bus.emit({ type: "channels" });
  }

  /** Forget the paired chat and make a new link, e.g. after a lost phone. */
  unpair() {
    this.forgetPairing();
    this.store.kvSet(K.code, crypto.randomBytes(9).toString("base64url"));
    bus.emit({ type: "channels" });
  }

  status(): TelegramStatus {
    const configured = !!this.token();
    const chat = this.chat();
    return {
      configured,
      bot: configured ? this.bot : null,
      paired: chat ? { name: chat.name } : null,
      pairUrl: configured && this.bot && !chat && this.code() ? `https://t.me/${this.bot}?start=${this.code()}` : null,
      error: configured ? this.error : null,
    };
  }

  // ---------- inbound ----------

  private async poll(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const offset = Number(this.store.kvGet(K.offset) ?? 0);
        const updates = await this.call<TgUpdate[]>("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, signal);
        if (this.error) {
          this.error = null;
          bus.emit({ type: "channels" });
        }
        for (const u of updates) {
          // Advance first: a message that crashes the handler shouldn't be retried forever.
          // Retrying is safe anyway, since message ids dedupe in the store.
          this.store.kvSet(K.offset, String(u.update_id + 1));
          try {
            if (u.message) await this.onMessage(u.message);
            else if (u.callback_query) await this.onButton(u.callback_query);
          } catch (err: any) {
            console.error("[bits] telegram update failed:", err.message);
          }
        }
      } catch (err: any) {
        if (signal.aborted) return;
        this.error = err instanceof TelegramError && err.code === 401 ? "Telegram rejected the bot token." : `Can't reach Telegram: ${err.message}`;
        bus.emit({ type: "channels" });
        if (err instanceof TelegramError && err.code === 401) return;
        await sleep(5000, signal);
      }
    }
  }

  private async onMessage(msg: TgMessage) {
    if (msg.chat.type !== "private") return;
    const chat = this.chat();
    const text = msg.text?.trim() ?? "";

    if (!chat) {
      const code = this.code();
      if (code && text === `/start ${code}`) {
        const name = msg.chat.username ? `@${msg.chat.username}` : (msg.chat.first_name ?? "you");
        this.store.kvSet(K.chat, JSON.stringify({ id: msg.chat.id, name } satisfies Chat));
        this.store.kvSet(K.code, "");
        bus.emit({ type: "channels" });
        await this.send(msg.chat.id, "Paired. Message me here any time, and routine results and anything that needs your OK will show up here too.");
      } else {
        await this.send(msg.chat.id, "This Bits isn't paired yet. Open the pairing link from Bits → Connectors on your computer.");
      }
      return;
    }
    if (msg.chat.id !== chat.id) return; // not the owner: stay silent

    if (text === "/stop") {
      this.runtime.cancel(HOME);
      return;
    }
    if (text === "/start" || text.startsWith("/start ") || text === "/help") {
      await this.send(chat.id, "I'm here. Send a message or a voice note. /stop stops what I'm doing.");
      return;
    }

    let body = text;
    const audio = msg.voice ?? msg.audio;
    if (!body && audio) {
      if (config.voice.stt !== "openai") {
        await this.send(chat.id, "I can't hear voice notes yet. Set OPENAI_API_KEY on the computer running Bits.");
        return;
      }
      await this.typing(chat.id, HOME, true);
      body = await speechToText(await this.download(audio.file_id), audio.mime_type ?? "audio/ogg");
      if (!body) {
        await this.send(chat.id, "I couldn't make out that voice note.");
        return;
      }
    }
    if (!body) {
      await this.send(chat.id, "I can only read text and voice notes here for now.");
      return;
    }

    // Everything from here on in Home goes back to the phone until the turn settles.
    if (this.store.kvGet(K.deliver(HOME)) === null) this.store.kvSet(K.deliver(HOME), String(this.store.getConversation(HOME)!.lastSeq));
    this.runtime.sendMessage(HOME, { id: `tg-${chat.id}-${msg.message_id}`, text: body, source: "telegram" });
    await this.typing(chat.id, HOME, true);
  }

  private async onButton(q: NonNullable<TgUpdate["callback_query"]>) {
    const chat = this.chat();
    if (!chat || q.message?.chat.id !== chat.id) return;
    const [kind, id, decision] = (q.data ?? "").split(":");
    if (kind !== "a" || !["approve", "deny", "always"].includes(decision)) return;
    const approval = this.runtime.decideApproval(id, decision as "approve" | "deny" | "always");
    await this.call("answerCallbackQuery", { callback_query_id: q.id, text: approval ? (decision === "deny" ? "Denied" : "Approved") : "Already handled" });
  }

  // ---------- outbound ----------

  private async onEvent(e: ServerEvent) {
    const chat = this.chat();
    if (!chat) return;

    if (e.type === "changed") {
      // A routine woke Bits: start delivering this conversation to the phone.
      if (this.store.kvGet(K.deliver(e.conversationId)) !== null) return;
      const [m] = this.store.getMessages(e.conversationId, e.seq - 1, 1);
      if (m?.role === "user" && m.meta?.source === "routine") this.store.kvSet(K.deliver(e.conversationId), String(e.seq - 1));
      return;
    }

    if (e.type === "turn") {
      const from = this.store.kvGet(K.deliver(e.conversationId));
      if (from === null) return;
      if (e.status === "running") return void (await this.typing(chat.id, e.conversationId));
      if (e.status !== "waiting" && !isTerminal(e.status)) return;
      await this.flush(chat, e.conversationId, Number(from));
      return;
    }

    if (e.type === "approval") {
      await this.onApproval(chat, e.approval);
    }
  }

  /** Sends what Bits said since `from`, then moves the marker (or drops it once nothing is left running). */
  private async flush(chat: Chat, conversationId: string, from: number) {
    const messages = this.store.getMessages(conversationId, from, 1000);
    const last = messages.at(-1)?.seq ?? from;
    this.store.kvSet(K.deliver(conversationId), String(last));
    const title = conversationId === HOME ? "" : this.store.getConversation(conversationId)?.title;
    const out = messages.map(render).filter(Boolean).join("\n\n");
    if (out) await this.send(chat.id, title ? `${title}\n\n${out}` : out);
    if (!this.store.activeTurn(conversationId)) this.store.db.prepare("DELETE FROM kv WHERE key = ?").run(K.deliver(conversationId));
  }

  private async onApproval(chat: Chat, a: Approval) {
    const sent = this.store.kvGet(K.approval(a.id));
    if (a.status !== "pending") {
      if (!sent) return;
      this.store.db.prepare("DELETE FROM kv WHERE key = ?").run(K.approval(a.id));
      await this.call("editMessageText", {
        chat_id: chat.id,
        message_id: Number(sent),
        text: `${describe(a)}\n\n${a.status === "approved" ? "✓ Approved" : "✗ Denied"}`,
      }).catch(() => {});
      return;
    }
    if (sent || this.store.kvGet(K.deliver(a.conversationId)) === null) return;
    // Say what Bits was in the middle of first, so the question has context.
    const from = this.store.kvGet(K.deliver(a.conversationId));
    if (from !== null) await this.flush(chat, a.conversationId, Number(from));
    const m = await this.call<{ message_id: number }>("sendMessage", {
      chat_id: chat.id,
      text: describe(a),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: `a:${a.id}:approve` },
            { text: "Deny", callback_data: `a:${a.id}:deny` },
          ],
          [{ text: `Always allow ${a.toolName}`, callback_data: `a:${a.id}:always` }],
        ],
      },
    });
    this.store.kvSet(K.approval(a.id), String(m.message_id));
  }

  private async typing(chatId: number, conversationId: string, force = false) {
    const now = Date.now();
    if (!force && now - (this.lastTyping.get(conversationId) ?? 0) < 4000) return;
    this.lastTyping.set(conversationId, now);
    await this.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  }

  private async send(chatId: number, text: string) {
    for (let i = 0; i < text.length; i += MAX_LEN) {
      await this.call("sendMessage", { chat_id: chatId, text: text.slice(i, i + MAX_LEN), link_preview_options: { is_disabled: true } });
    }
  }

  // ---------- plumbing ----------

  private token() {
    try {
      return secrets.get(TOKEN) ?? null;
    } catch {
      return null;
    }
  }
  private chat(): Chat | null {
    const raw = this.store.kvGet(K.chat);
    return raw ? (JSON.parse(raw) as Chat) : null;
  }
  private code() {
    return this.store.kvGet(K.code) || null;
  }
  private forgetPairing() {
    this.store.db.prepare("DELETE FROM kv WHERE key LIKE 'telegram.%'").run();
  }

  private async call<T = unknown>(method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const token = this.token();
    if (!token) throw new Error("Telegram isn't set up");
    // Never put the URL in an error: it contains the token.
    const r = await fetch(`${this.api}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal,
    });
    const j = (await r.json().catch(() => ({ ok: false, error_code: r.status, description: r.statusText }))) as {
      ok: boolean;
      result: T;
      error_code?: number;
      description?: string;
    };
    if (!j.ok) throw new TelegramError(j.error_code ?? r.status, j.description ?? `HTTP ${r.status}`);
    return j.result;
  }

  private async download(fileId: string): Promise<Uint8Array> {
    const f = await this.call<{ file_path: string }>("getFile", { file_id: fileId });
    const r = await fetch(`${this.api}/file/bot${this.token()}/${f.file_path}`);
    if (!r.ok) throw new Error(`Couldn't download the voice note (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }
}

/** What the phone should see from one stored message. */
function render(m: Message): string {
  if (m.role === "assistant") {
    const made = m.parts
      .filter((p) => p.type === "tool-call" && SHOWS_IN_APP[p.toolName])
      .map((p) => {
        const input = (p as { input: any }).input ?? {};
        return `(Made ${SHOWS_IN_APP[(p as { toolName: string }).toolName]}${input.title ? ` “${input.title}”` : ""}. Open Bits to see it.)`;
      });
    return [textOf(m.parts), ...made].filter(Boolean).join("\n");
  }
  if (m.role === "event") {
    const t = textOf(m.parts);
    return t.startsWith("Something went wrong") || t === "Stopped" ? t : "";
  }
  return "";
}

function describe(a: Approval) {
  const input = JSON.stringify(a.input);
  return `Bits wants to run ${a.toolName}\n${input.length > 600 ? input.slice(0, 600) + "…" : input}\n\n${a.reason}`;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
  });
}
