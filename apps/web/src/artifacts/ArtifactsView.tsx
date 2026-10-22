import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowUp, Bot, ExternalLink, Menu, Sparkles, User, Zap } from "lucide-react";
import type { ArtifactActivity } from "@bits/protocol";
import { useArtifacts } from "../store/artifacts";
import { HOME, useChat } from "../store/chat";
import { relTime } from "../lib/text";
import { IconButton } from "../components/IconButton";
import { Mascot } from "../components/Mascot";
import { artifactIcon } from "./icon";
import { KindBadge } from "./ArtifactEmbed";
import { ArtifactView } from "./ArtifactView";

const SUGGESTIONS = ["Make me a habit tracker", "Plan a 3-day trip to Lisbon as an artifact", "Track my reading list"];

function startChat(text: string) {
  const chat = useChat.getState();
  chat.setActive(HOME);
  void chat.send(HOME, text);
}

function TopBar({ onMenu, children }: { onMenu: () => void; children?: ReactNode }) {
  return (
    <div className="drag traffic-pad flex h-12 items-center gap-2 px-3 pt-3">
      <IconButton label="Open menu" onClick={onMenu} className="md:hidden">
        <Menu size={18} />
      </IconButton>
      {children}
    </div>
  );
}

function Shelf({ onMenu }: { onMenu: () => void }) {
  const list = useArtifacts((s) => s.list);
  const listError = useArtifacts((s) => s.listError);
  const openPage = useArtifacts((s) => s.openPage);
  return (
    <>
      <TopBar onMenu={onMenu} />
      <div className="mx-auto w-full max-w-[1040px] px-4 pt-2 pb-16 sm:px-6 sm:pt-6">
        <div className="mb-8">
          <h1 className="font-serif text-[36px] leading-none tracking-[-0.015em] text-ink sm:text-[42px]">Artifacts</h1>
          <p className="mt-2 max-w-[560px] text-[14px] text-muted">
            Little apps Bits makes for you. They keep their own data, and you, Bits, or any browser agent can use them.
          </p>
        </div>

        {list === null && !listError && <div className="shimmer py-10 text-center text-[13.5px]">Gathering your artifacts…</div>}
        {listError && list === null && (
          <div className="rounded-[18px] border border-line bg-surface p-5 text-[14px] text-muted">Couldn’t reach Bits. This will refresh once it’s back.</div>
        )}

        {list && list.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center rounded-[24px] border border-dashed border-line-2 px-6 py-12 text-center"
          >
            <Mascot state="idle" size={72} />
            <h2 className="mt-5 font-serif text-[28px] leading-tight text-ink">Nothing here yet</h2>
            <p className="mt-2 max-w-[460px] text-[14px] text-muted">
              Ask Bits for a tracker, a planner or a list and it’ll build a small app that remembers things — right here, ready to reopen any time.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => startChat(s)}
                  className="rounded-full border border-line-2 bg-surface px-3.5 py-2 text-[13.5px] text-ink-2 shadow-soft transition-colors hover:border-accent/50 hover:text-accent-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {list && list.length > 0 && (
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {list.map((a) => {
              const Icon = artifactIcon(a);
              return (
                <motion.button
                  key={a.id}
                  type="button"
                  variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                  whileHover={{ y: -2 }}
                  onClick={() => openPage(a.id)}
                  className="flex min-h-[148px] flex-col rounded-[20px] border border-line bg-surface p-4 text-left shadow-soft transition-colors hover:border-accent/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-accent-soft text-accent-ink">
                      <Icon size={19} />
                    </span>
                    <KindBadge kind={a.kind} />
                  </div>
                  <div className="mt-3 font-semibold tracking-[-0.01em] text-ink">{a.title}</div>
                  <div className="mt-0.5 line-clamp-2 flex-1 text-[13px] text-muted">{a.description}</div>
                  <div className="mt-3 text-[12px] text-faint">Updated {relTime(a.updatedAt)}</div>
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </div>
    </>
  );
}

const WHO: Record<ArtifactActivity["by"], { label: string; icon: typeof User }> = {
  person: { label: "You", icon: User },
  bits: { label: "Bits", icon: Sparkles },
  agent: { label: "Browser agent", icon: Bot },
};

function Rail({ id }: { id: string }) {
  const meta = useArtifacts((s) => s.byId[id]);
  const activity = useArtifacts((s) => s.activity[id]);
  const loadActivity = useArtifacts((s) => s.loadActivity);
  const [ask, setAsk] = useState("");
  useEffect(() => {
    void loadActivity(id);
  }, [id, loadActivity]);
  if (!meta) return null;

  const send = () => {
    const t = ask.trim();
    if (!t) return;
    const chat = useChat.getState();
    void chat.send(meta.conversationId, `About the artifact "${meta.title}" (${meta.id}): ${t}`);
    setAsk("");
    chat.setActive(meta.conversationId);
  };

  return (
    <aside className="flex min-w-0 flex-col gap-4">
      <section className="rounded-[20px] border border-line bg-surface p-4 shadow-soft">
        <div className="mb-2 text-[13px] font-semibold text-ink">Ask Bits about this</div>
        <div className="flex items-end gap-1.5 rounded-[16px] border border-line bg-surface-2 p-1.5 pl-3 focus-within:border-accent/40">
          <textarea
            rows={1}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Add a column for ratings…"
            aria-label="Ask Bits about this artifact"
            className="min-h-[24px] flex-1 resize-none self-center bg-transparent py-1 text-[14px] text-ink outline-none placeholder:text-faint focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={!ask.trim()}
            aria-label="Send to Bits"
            className={`grid h-8 w-8 flex-none place-items-center rounded-full transition-all ${ask.trim() ? "bg-accent text-white" : "bg-surface text-faint"}`}
          >
            <ArrowUp size={16} strokeWidth={2.4} />
          </button>
        </div>
      </section>

      <section className="rounded-[20px] border border-line bg-surface p-4 shadow-soft">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-ink">Actions</span>
          <span className="text-[11.5px] text-faint">usable by you, Bits & browser agents</span>
        </div>
        <ul className="flex flex-col gap-2">
          {Object.entries(meta.actions ?? {}).map(([name, a]) => (
            <li key={name} className="flex items-start gap-2">
              <Zap size={13} className="mt-[3px] flex-none text-accent" />
              <div className="min-w-0">
                <code className="font-mono text-[12px] text-ink">{name}</code>
                {a.confirm && <span className="ml-1.5 rounded bg-[var(--a-amber-soft)] px-1 text-[10.5px] text-[var(--a-amber)]">asks first</span>}
                <div className="text-[12.5px] text-muted">{a.description}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[20px] border border-line bg-surface p-4 shadow-soft">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-ink">Activity</span>
          <span className="text-[11.5px] text-faint">v{meta.version}</span>
        </div>
        {!activity?.length ? (
          <p className="text-[12.5px] text-muted">Nothing has happened here yet.</p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {[...activity].reverse().slice(0, 30).map((ev, i) => {
              const who = WHO[ev.by] ?? WHO.person;
              const Icon = who.icon;
              return (
                <li key={`${ev.at}-${i}`} className="flex items-start gap-2.5 text-[12.5px]">
                  <span className={`mt-[1px] grid h-5 w-5 flex-none place-items-center rounded-full ${ev.by === "agent" ? "bg-[var(--a-blue-soft)] text-[var(--a-blue)]" : ev.by === "bits" ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-ink-2"}`}>
                    <Icon size={11} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{who.label}</span> <span className="text-muted">ran</span> <code className="font-mono text-[11.5px] text-ink-2">{ev.action}</code>
                    <div className="text-[11.5px] text-faint">{relTime(ev.at)}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </aside>
  );
}

function Page({ id, onMenu }: { id: string; onMenu: () => void }) {
  const meta = useArtifacts((s) => s.byId[id]);
  const openPage = useArtifacts((s) => s.openPage);
  const Icon = artifactIcon(meta ?? {});
  return (
    <>
      <TopBar onMenu={onMenu}>
        <button
          type="button"
          onClick={() => openPage(null)}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft size={15} /> Artifacts
        </button>
      </TopBar>
      <div className="mx-auto w-full max-w-[1180px] px-4 pt-2 pb-16 sm:px-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-11 w-11 flex-none place-items-center rounded-[14px] bg-accent-soft text-accent-ink">
            <Icon size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-serif text-[30px] leading-tight tracking-[-0.01em] text-ink">{meta?.title ?? "Artifact"}</h1>
              <KindBadge kind={meta?.kind} />
            </div>
            {meta?.description && <p className="truncate text-[13.5px] text-muted">{meta.description}</p>}
          </div>
          <a
            href={`${import.meta.env.BASE_URL}?artifact=${encodeURIComponent(id)}`}
            target="_blank"
            rel="noreferrer"
            title="Open on its own page (pin it for browser agents)"
            className="hidden flex-none items-center gap-1.5 rounded-full border border-line-2 px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-accent/50 hover:text-accent-ink sm:flex"
          >
            <ExternalLink size={13} /> Standalone
          </a>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 rounded-[22px] border border-line bg-surface p-4 shadow-soft sm:p-5">
            <ArtifactView id={id} />
          </div>
          <Rail id={id} />
        </div>
      </div>
    </>
  );
}

export function ArtifactsView({ onMenu }: { onMenu: () => void }) {
  const pageId = useArtifacts((s) => s.pageId);
  const loadList = useArtifacts((s) => s.loadList);
  useEffect(() => {
    void loadList();
  }, [loadList]);
  return (
    <div className="scroll-thin h-full flex-1 overflow-y-auto overflow-x-hidden">
      {pageId ? <Page key={pageId} id={pageId} onMenu={onMenu} /> : <Shelf onMenu={onMenu} />}
    </div>
  );
}
