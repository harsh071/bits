import { AppWindow, Brain, House, Moon, MessageCircle, Plug, Plus, Sun } from "lucide-react";
import { useArtifacts } from "../store/artifacts";
import { HOME, useChat } from "../store/chat";
import { useTheme } from "../store/theme";
import { shortTime } from "../lib/text";
import { Mascot } from "./Mascot";
import { useAgentStatus } from "../lib/status";

function NavItem({
  active,
  icon,
  label,
  meta,
  dot,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  meta?: string;
  dot?: "running" | "waiting";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[14px] transition-colors ${
        active ? "bg-surface text-ink shadow-soft ring-1 ring-line" : "text-ink-2 hover:bg-surface/70 hover:text-ink"
      }`}
    >
      <span className={`flex-none ${active ? "text-accent" : "text-muted group-hover:text-ink-2"}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {dot && (
        <span
          className={`h-1.5 w-1.5 flex-none rounded-full ${dot === "waiting" ? "bg-[var(--a-amber)]" : "animate-pulse bg-accent"}`}
          aria-label={dot === "waiting" ? "Needs you" : "Working"}
        />
      )}
      {meta && !dot && <span className="flex-none text-[11.5px] text-faint">{meta}</span>}
    </button>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const view = useChat((s) => s.view);
  const turns = useChat((s) => s.turns);
  const setActive = useChat((s) => s.setActive);
  const setView = useChat((s) => s.setView);
  const newConversation = useChat((s) => s.newConversation);
  const { dark, cycle } = useTheme();
  const status = useAgentStatus(activeId);

  const dotFor = (id: string) => {
    const t = turns[id]?.status;
    return t === "waiting" ? "waiting" : t === "running" || t === "queued" ? "running" : undefined;
  };
  const others = conversations.filter((c) => c.id !== HOME);
  const go = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="drag sidebar-top flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Mascot state={status.state} size={30} />
        <div className="font-serif text-[24px] leading-none tracking-[-0.01em] text-ink">Bits</div>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={go(() => void newConversation().catch(() => {}))}
          className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-line-2 px-2.5 py-2 text-[14px] text-ink-2 transition-colors hover:border-accent/50 hover:bg-surface hover:text-ink"
        >
          <Plus size={16} className="text-muted" />
          New chat
        </button>
      </div>

      <nav className="mt-3 flex flex-col gap-0.5 px-3" aria-label="Main">
        <NavItem
          active={view === "chat" && activeId === HOME}
          icon={<House size={16} />}
          label="Home"
          dot={dotFor(HOME)}
          onClick={go(() => setActive(HOME))}
        />
        <NavItem
          active={view === "artifacts"}
          icon={<AppWindow size={16} />}
          label="Artifacts"
          onClick={go(() => {
            useArtifacts.getState().openPage(null);
            setView("artifacts");
          })}
        />
        <NavItem active={view === "memory"} icon={<Brain size={16} />} label="What Bits knows" onClick={go(() => setView("memory"))} />
        <NavItem active={view === "connectors"} icon={<Plug size={16} />} label="Connectors" onClick={go(() => setView("connectors"))} />
      </nav>

      {others.length > 0 && (
        <div className="mt-5 px-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Conversations</div>
      )}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="flex flex-col gap-0.5">
          {others.map((c) => (
            <NavItem
              key={c.id}
              active={view === "chat" && activeId === c.id}
              icon={<MessageCircle size={15} />}
              label={c.title || "New chat"}
              meta={shortTime(c.updatedAt)}
              dot={dotFor(c.id)}
              onClick={go(() => setActive(c.id))}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[12px] text-faint">
        <span>Local · private</span>
        <button
          type="button"
          onClick={cycle}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          title={dark ? "Light mode" : "Dark mode"}
          className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </div>
  );
}
