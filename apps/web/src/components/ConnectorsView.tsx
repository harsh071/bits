import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, KeyRound, Menu, Plug, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import type { ConnectorInfo, ConnectorPreset } from "@bits/protocol";
import { api } from "../api";
import { useConnectors } from "../store/connectors";
import { IconButton } from "./IconButton";
import { Mascot } from "./Mascot";
import { Section, Sheet, Switch } from "./MemoryView";
import { TelegramSection } from "./TelegramSection";

const STORE_LABEL = { keychain: "macOS Keychain", "secret-service": "your system keyring", file: "a local key file" } as const;

const STATE: Record<ConnectorInfo["state"], { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "text-[var(--a-green)] bg-[color-mix(in_srgb,var(--a-green)_12%,transparent)]" },
  connecting: { label: "Connecting…", tone: "text-muted bg-surface-2" },
  needs_auth: { label: "Needs sign-in", tone: "text-accent-ink bg-accent-soft" },
  error: { label: "Error", tone: "text-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]" },
  disabled: { label: "Off", tone: "text-faint bg-surface-2" },
};

const inputCls =
  "w-full rounded-[12px] border border-line bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/50 focus:bg-surface";
const pillBtn =
  "flex flex-none items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-accent/40 hover:text-accent-ink disabled:opacity-40";

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

/** Two steps on purpose: the daemon makes the sign-in URL, then a real click opens it (no popup blockers). */
function SignIn({ name }: { name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(() => setUrl(null), 500)} className={`${pillBtn} border-accent/50 text-accent-ink`}>
        Continue to sign in <ExternalLink size={12} />
      </a>
    );
  }
  return (
    <>
      {err && <span className="text-[12px] text-danger">{err}</span>}
      <button
        type="button"
        disabled={busy}
        className={`${pillBtn} border-accent/50 text-accent-ink`}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await api.beginAuth(name);
            if (r.url) setUrl(r.url);
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Starting…" : "Sign in"}
      </button>
    </>
  );
}

function ConnectorRow({ c, first }: { c: ConnectorInfo; first: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch {
      /* the list refreshes with the error */
    } finally {
      setBusy(false);
    }
  };
  const s = STATE[c.state];
  return (
    <li className={`py-3 ${first ? "pt-0" : "border-t border-line"}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-medium ${c.state === "disabled" ? "text-muted" : "text-ink"}`}>{c.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${s.tone}`}>{s.label}</span>
            {c.kind === "local" && <span className="text-[11.5px] text-faint">runs on this Mac</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-muted">{c.target}</div>
          {c.missingSecrets.length > 0 && (
            <div className="mt-1 text-[12.5px] text-danger">Missing key{c.missingSecrets.length > 1 ? "s" : ""}: {c.missingSecrets.join(", ")}</div>
          )}
          {c.error && c.state !== "needs_auth" && <div className="mt-1 line-clamp-2 text-[12.5px] text-danger">{c.error}</div>}
          {c.tools.length > 0 && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-[12.5px] text-muted hover:text-ink">
              {c.tools.length} tool{c.tools.length === 1 ? "" : "s"} {open ? "▴" : "▾"}
            </button>
          )}
        </div>
        <div className="flex flex-none flex-wrap items-center justify-end gap-2">
          {c.state === "needs_auth" && c.auth === "oauth" && <SignIn name={c.name} />}
          {(c.state === "error" || c.state === "needs_auth") && (
            <IconButton label={`Reconnect ${c.name}`} size="sm" onClick={run(() => api.reconnect(c.name))}>
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
            </IconButton>
          )}
          <IconButton
            label={`Remove ${c.name}`}
            size="sm"
            onClick={run(async () => {
              if (window.confirm(`Remove ${c.name}? Its saved sign-in and key are deleted too.`)) await api.removeConnector(c.name);
            })}
          >
            <Trash2 size={14} />
          </IconButton>
          <Switch checked={c.state !== "disabled"} label={`${c.state === "disabled" ? "Turn on" : "Turn off"} ${c.name}`} onChange={(v) => void run(() => api.setConnectorDisabled(c.name, !v))()} />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 overflow-hidden">
            {c.tools.map((t) => (
              <li key={t.name} className="flex items-baseline gap-2 py-1 text-[12.5px]">
                <span className="font-mono text-ink-2">{t.name.split("__").slice(2).join("__")}</span>
                <span className="text-faint">{t.risk === "read" ? "reads" : t.risk === "destructive" ? "always asks" : "auto-reviewed"}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

function AddSheet({ preset, onClose }: { preset: ConnectorPreset | "custom"; onClose: () => void }) {
  const add = useConnectors((s) => s.add);
  const p = preset === "custom" ? null : preset;
  const [name, setName] = useState(p?.id ?? "");
  const [url, setUrl] = useState(p?.url ?? "");
  const [auth, setAuth] = useState(p?.auth ?? "oauth");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await add({ name, preset: p?.id, url: p?.url ? undefined : url, auth: p ? undefined : auth, apiKey: auth === "key" ? apiKey : undefined });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={p ? `Connect ${p.name}` : "Add a server"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {p && <p className="text-[13.5px] text-ink-2">{p.blurb}</p>}
        <Field label="Name" hint="Bits sees this connector's tools as mcp__name__tool.">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="notion" autoFocus={!p} required />
        </Field>
        {!p?.url && (
          <Field label="Server URL" hint={p?.urlHint ? <>Copy it from your {p.name} dashboard, e.g. <code className="font-mono">{p.urlHint}</code></> : "A remote MCP server (Streamable HTTP, https)."}>
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={p?.urlHint ?? "https://example.com/mcp"} inputMode="url" required />
          </Field>
        )}
        {!p && (
          <Field label="How it signs in">
            <select className={inputCls} value={auth} onChange={(e) => setAuth(e.target.value as typeof auth)}>
              <option value="oauth">Sign in with the provider (OAuth)</option>
              <option value="key">API key (sent as a Bearer token)</option>
              <option value="none">No sign-in</option>
            </select>
          </Field>
        )}
        {auth === "key" && (
          <Field
            label={p?.keyLabel ?? "API key"}
            hint={
              <>
                Encrypted on this machine. Bits' model never sees it.{" "}
                {p?.keyUrl && (
                  <a href={p.keyUrl} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline-offset-2 hover:underline">
                    Get a key ↗
                  </a>
                )}
              </>
            }
          >
            <input className={`${inputCls} font-mono`} type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
          </Field>
        )}
        {auth === "oauth" && <p className="text-[12.5px] text-muted">After adding, press Sign in. Your browser opens the provider's own page, and the sign-in comes back to Bits on this machine only.</p>}
        {err && <p className="text-[13px] text-danger">{err}</p>}
        <div className="flex items-center justify-end gap-3">
          {p?.docsUrl && (
            <a href={p.docsUrl} target="_blank" rel="noopener noreferrer" className="mr-auto text-[13px] text-muted hover:text-ink">
              Docs ↗
            </a>
          )}
          <button type="button" onClick={onClose} className="text-[13px] text-muted hover:text-ink">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-full bg-ink px-4 py-1.5 text-[13.5px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-35">
            {busy ? "Connecting…" : "Add"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function Keys({ names }: { names: string[] }) {
  const load = useConnectors((s) => s.load);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {names.length > 0 && (
        <ul className="flex flex-col">
          {names.map((n) => (
            <li key={n} className="flex items-center gap-2 py-1.5">
              <KeyRound size={13} className="text-faint" />
              <code className="flex-1 truncate font-mono text-[12.5px] text-ink-2">{n}</code>
              <span className="font-mono text-[12px] text-faint">••••••</span>
              <IconButton
                label={`Delete ${n}`}
                size="sm"
                onClick={async () => {
                  if (!window.confirm(`Delete the key ${n}? Connectors that use it will stop working.`)) return;
                  await api.deleteSecret(n).catch(() => {});
                  void load();
                }}
              >
                <Trash2 size={13} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await api.setSecret(name.trim(), value);
            setName("");
            setValue("");
            void load();
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <input className={`${inputCls} sm:w-[38%]`} value={name} onChange={(e) => setName(e.target.value)} placeholder="name, e.g. todoist" required />
        <input className={`${inputCls} flex-1 font-mono`} type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" required />
        <button type="submit" className="rounded-full bg-ink px-4 py-1.5 text-[13.5px] font-medium text-bg hover:opacity-90">
          Save
        </button>
      </form>
      {err && <p className="text-[12.5px] text-danger">{err}</p>}
      <p className="text-[12px] text-muted">
        Use a key in <code className="font-mono">connectors.json</code> as <code className="font-mono">{"{{secret:name}}"}</code> in a header or env value.
      </p>
    </div>
  );
}

export function ConnectorsView({ onMenu }: { onMenu: () => void }) {
  const { data, error, load } = useConnectors();
  const [adding, setAdding] = useState<ConnectorPreset | "custom" | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const used = new Set(data?.connectors.map((c) => c.preset).filter(Boolean));

  return (
    <div className="scroll-thin h-full flex-1 overflow-y-auto overflow-x-hidden">
      <div className="drag traffic-pad flex h-12 items-center px-3 pt-3">
        <IconButton label="Open menu" onClick={onMenu} className="md:hidden">
          <Menu size={18} />
        </IconButton>
      </div>
      <div className="mx-auto w-full max-w-[880px] px-4 pt-2 pb-16 sm:px-6 sm:pt-6">
        <div className="mb-8 flex items-end gap-4">
          <Mascot state={data ? "idle" : "thinking"} size={56} />
          <div className="min-w-0">
            <h1 className="font-serif text-[36px] leading-none tracking-[-0.015em] text-ink sm:text-[42px]">Connectors</h1>
            <p className="mt-2 text-[13.5px] text-muted">Let Bits use your apps. Keys and sign-ins stay on this machine, encrypted, and the model never sees them.</p>
          </div>
        </div>

        {error && !data && <div className="rounded-[18px] border border-line bg-surface p-5 text-[14px] text-muted">Couldn’t reach Bits to load connectors.</div>}

        {data && (
          <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }} className="flex flex-col gap-4">
            <Section icon={<Plug size={16} />} title="Your connectors" hint="Reading tools run freely. Anything that sends or changes things is checked first.">
              {data.connectors.length === 0 ? (
                <p className="text-[13.5px] text-muted">Nothing connected yet. Pick one below.</p>
              ) : (
                <ul className="flex flex-col">
                  {data.connectors.map((c, i) => (
                    <ConnectorRow key={c.name} c={c} first={i === 0} />
                  ))}
                </ul>
              )}
            </Section>

            <Section icon={<Plus size={16} />} title="Add a connector" hint="Any MCP server works. These are one click.">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={used.has(p.id)}
                    onClick={() => setAdding(p)}
                    className="rounded-[14px] border border-line px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-surface-2 disabled:opacity-45 disabled:hover:border-line disabled:hover:bg-transparent"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-ink">{p.name}</span>
                      <span className="text-[11px] text-faint">{used.has(p.id) ? "added" : p.auth === "oauth" ? "sign in" : "API key"}</span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{p.blurb}</div>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setAdding("custom")}
                  className="rounded-[14px] border border-dashed border-line-2 px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-surface-2"
                >
                  <div className="text-[14px] font-medium text-ink">Custom server</div>
                  <div className="mt-0.5 text-[12.5px] text-muted">Paste any remote MCP server URL.</div>
                </button>
              </div>
              <p className="mt-3 text-[12px] text-muted">
                Servers that run on this machine (<code className="font-mono">npx …</code>) are added by editing <code className="font-mono">{data.configPath}</code>, so a web page can never install one.
              </p>
            </Section>

            <TelegramSection />

            <Section icon={<ShieldCheck size={16} />} title="Keys" hint={`Encrypted with a key held in ${STORE_LABEL[data.keyStore]}. Values can't be read back.`}>
              <Keys names={data.secrets} />
            </Section>
          </motion.div>
        )}
      </div>

      <AnimatePresence>{adding && <AddSheet key="add" preset={adding} onClose={() => setAdding(null)} />}</AnimatePresence>
    </div>
  );
}
