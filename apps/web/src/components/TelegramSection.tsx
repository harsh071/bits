import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Send } from "lucide-react";
import type { TelegramStatus } from "@bits/protocol";
import { api } from "../api";
import { onReconnect, onServerEvent } from "../store/sync";
import { Section } from "./MemoryView";

const inputCls =
  "w-full rounded-[12px] border border-line bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/50 focus:bg-surface";
const pillBtn =
  "flex flex-none items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-accent/40 hover:text-accent-ink disabled:opacity-40";

/** Telegram: chat with Bits from your phone, get routine results there, approve with a tap. */
export function TelegramSection() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = () => void api.telegram().then(setStatus, () => {});
    load();
    const off = onServerEvent((ev) => ev.type === "channels" && load());
    const offReconnect = onReconnect(load);
    return () => {
      off();
      offReconnect();
    };
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      setStatus(await api.telegram());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  return (
    <Section icon={<Send size={16} />} title="Telegram" hint="Message Bits from your phone. Routine results and anything that needs your OK show up there too.">
      {!status.configured && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.setupTelegram(token);
              setToken("");
            });
          }}
        >
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13.5px] text-ink-2">
            <li>
              In Telegram, open{" "}
              <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-accent-ink underline-offset-2 hover:underline">
                @BotFather
              </a>{" "}
              and send <code className="font-mono">/newbot</code>. Any name works.
            </li>
            <li>Paste the token it gives you here.</li>
          </ol>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className={`${inputCls} flex-1 font-mono`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:AAF…"
              required
            />
            <button type="submit" disabled={busy} className="rounded-full bg-ink px-4 py-1.5 text-[13.5px] font-medium text-bg hover:opacity-90 disabled:opacity-35">
              {busy ? "Checking…" : "Connect"}
            </button>
          </div>
          <p className="text-[12px] text-muted">The token is encrypted on this machine. Bits talks to Telegram from here, so nothing on the internet can reach your computer.</p>
        </form>
      )}

      {status.configured && !status.paired && (
        <div className="flex flex-col gap-3">
          {status.pairUrl ? (
            <>
              <p className="text-[13.5px] text-ink-2">
                Last step: open this link on your phone and tap <span className="font-medium text-ink">Start</span>. Only that chat will be able to talk to Bits.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a href={status.pairUrl} target="_blank" rel="noopener noreferrer" className={`${pillBtn} border-accent/50 text-accent-ink`}>
                  Open @{status.bot} <ExternalLink size={12} />
                </a>
                <button
                  type="button"
                  className={pillBtn}
                  onClick={() => {
                    void navigator.clipboard?.writeText(status.pairUrl!).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy link"}
                </button>
                <span className="flex items-center gap-1.5 text-[12.5px] text-faint">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Waiting for you
                </span>
              </div>
            </>
          ) : (
            !status.error && <p className="text-[13.5px] text-muted">Checking the bot…</p>
          )}
        </div>
      )}

      {status.configured && status.paired && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[color-mix(in_srgb,var(--a-green)_12%,transparent)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--a-green)]">Paired</span>
          <span className="text-[13.5px] text-ink-2">
            {status.paired.name} {status.bot && <span className="text-muted">via @{status.bot}</span>}
          </span>
          <button
            type="button"
            disabled={busy}
            className={`${pillBtn} ml-auto`}
            onClick={() => {
              if (window.confirm(`Unpair ${status.paired!.name}? You'll get a new link to pair again.`)) void run(api.unpairTelegram);
            }}
          >
            Unpair
          </button>
        </div>
      )}

      {status.configured && (
        <div className="mt-3 flex items-center gap-3">
          {status.error && <p className="flex-1 text-[12.5px] text-danger">{status.error}</p>}
          <button
            type="button"
            disabled={busy}
            className="ml-auto text-[12.5px] text-muted hover:text-danger"
            onClick={() => {
              if (window.confirm("Disconnect Telegram? The bot token and pairing are deleted.")) void run(api.removeTelegram);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-[12.5px] text-danger">{err}</p>}
    </Section>
  );
}
