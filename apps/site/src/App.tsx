import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CalendarDays,
  Check,
  Copy,
  Cpu,
  FileText,
  GitBranch,
  HardDrive,
  Lock,
  Mail,
  MessagesSquare,
  Moon,
  NotebookPen,
  Scale,
  Server,
  Sun,
} from "lucide-react";
import { Mascot, type MascotState } from "../../web/src/components/Mascot";
import { useMascotStyle } from "../../web/src/store/mascot";

const REPO = "https://github.com/harsh071/bits";
const DOCS = `${REPO}/tree/main/docs`;
const DEMO = "/demo/";
const IFH = "https://www.interfacesforhuman.com";
const AGENTABLE = "https://agentable.interfacesforhuman.com";

// Exactly the Quick start from README.md.
const INSTALL: { cmd: string; note?: string }[] = [
  { cmd: "cp .env.example .env", note: "add ANTHROPIC_API_KEY (or OPENAI_API_KEY, or set BITS_MODEL=local:<model>)" },
  { cmd: "pnpm install" },
  { cmd: "pnpm dev", note: "daemon on :7077, web app on :5320" },
  { cmd: "pnpm dev:desktop", note: "optional: tray icon + ⌥Space overlay" },
  { cmd: "pnpm service:install", note: "optional: keep the daemon running at login (launchd / systemd)" },
];

export function App() {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Features />
        <Connectors />
        <Flexible />
        <Install />
      </main>
      <Footer />
    </div>
  );
}

// ---------- shared bits ----------

function Wrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1120px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="mb-4 font-mono text-[12px] uppercase tracking-[0.14em] text-accent-ink">{children}</div>;
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[20px] border border-line bg-surface shadow-float ${className}`}>{children}</div>;
}

function ButtonLink({ href, children, primary, onHover }: { href: string; children: ReactNode; primary?: boolean; onHover?: (on: boolean) => void }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-medium transition-[background-color,box-shadow,transform] active:scale-[0.98] ${
        primary
          ? "bg-ink text-bg shadow-float hover:shadow-lift"
          : "border border-line-2 bg-surface text-ink hover:border-faint"
      }`}
    >
      {children}
    </a>
  );
}

// ---------- nav ----------

function useThemeToggle() {
  const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const read = () => {
    const t = document.documentElement.dataset.theme;
    return t === "dark" || (t !== "light" && !!media?.matches);
  };
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const on = () => setDark(read());
    media?.addEventListener("change", on);
    return () => media?.removeEventListener("change", on);
  });
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("bits.theme", next);
    } catch {
      /* ignore */
    }
    setDark(!dark);
  };
  return { dark, toggle };
}

function Nav() {
  const { dark, toggle } = useThemeToggle();
  const style = useMascotStyle((s) => s.style);
  const toggleStyle = useMascotStyle((s) => s.toggle);
  const other = style === "binary" ? "pixel" : "binary";
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-[var(--glass)] backdrop-blur-xl">
      <Wrap className="flex h-16 items-center gap-3">
        <a href="#top" className="flex items-center gap-2.5" aria-label="Bits home">
          <Mascot size={28} still title="" />
          <span className="font-serif text-[26px] leading-none tracking-[-0.01em]">Bits</span>
        </a>
        <nav className="ml-6 hidden items-center gap-6 text-[14px] text-ink-2 md:flex" aria-label="Sections">
          <a className="hover:text-ink" href="#local">Features</a>
          <a className="hover:text-ink" href="#connectors">Connectors</a>
          <a className="hover:text-ink" href="#install">Install</a>
          <a className="hover:text-ink" href={DOCS} target="_blank" rel="noreferrer">Docs</a>
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          onClick={toggleStyle}
          aria-label={`Show the ${other} look`}
          title={other === "pixel" ? "Pixel look" : "Binary look"}
          className="grid h-10 w-10 place-items-center rounded-full transition-colors hover:bg-surface-2"
        >
          <Mascot variant={other} still size={18} title="" />
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="grid h-10 w-10 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="hidden h-10 items-center gap-1.5 rounded-full border border-line-2 px-4 text-[14px] font-medium hover:border-faint sm:inline-flex"
        >
          GitHub
          <ArrowUpRight size={15} aria-hidden />
        </a>
      </Wrap>
    </header>
  );
}

// ---------- hero ----------

function Hero() {
  const [mood, setMood] = useState<MascotState>("idle");
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="bit-field pointer-events-none absolute inset-0" aria-hidden />
      <Wrap className="relative flex flex-col items-center pt-20 pb-16 text-center sm:pt-28">
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
          onMouseEnter={() => setMood("listening")}
          onMouseLeave={() => setMood("idle")}
        >
          <Mascot state={mood} size={104} title="Bits, the mascot" />
        </motion.div>

        <Reveal delay={0.05} className="mt-9">
          <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-line bg-surface/80 px-3.5 py-1.5 font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2">
            <span>Open source</span>
            <span className="text-faint" aria-hidden>·</span>
            <span>Local-first</span>
            <span className="text-faint" aria-hidden>·</span>
            <span>Always on</span>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <h1 className="mt-6 max-w-[16ch] font-serif text-[clamp(52px,9vw,104px)] leading-[0.95] tracking-[-0.025em]">
            The agent that stays awake for you.
          </h1>
        </Reveal>

        <Reveal delay={0.15}>
          <p className="mx-auto mt-7 max-w-[54ch] text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">
            Bits runs quietly on your own computer, remembers what matters in plain files, and answers with
            interfaces you can use, not walls of text.
          </p>
        </Reveal>

        <Reveal delay={0.2} className="mt-9 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
          <ButtonLink href={DEMO} primary onHover={(on) => setMood(on ? "working" : "idle")}>
            Try the demo
            <ArrowRight size={17} aria-hidden />
          </ButtonLink>
          <ButtonLink href={REPO}>
            View on GitHub
            <ArrowUpRight size={17} aria-hidden />
          </ButtonLink>
        </Reveal>
      </Wrap>

      <Wrap className="relative pb-24 sm:pb-32">
        <Reveal delay={0.1}>
          <LaunchVideo />
        </Reveal>
      </Wrap>
    </section>
  );
}

/** 16:9 slot for the launch film. Drop the file at apps/site/public/launch.mp4 and it plays. */
function LaunchVideo() {
  const [missing, setMissing] = useState(false);
  return (
    <figure className="relative mx-auto aspect-video w-full max-w-[1000px] overflow-hidden rounded-[24px] border border-line bg-[#131218] shadow-lift">
      <video
        className="h-full w-full object-cover"
        controls={!missing}
        preload="metadata"
        playsInline
        poster="/launch-poster.svg"
        aria-label="The Bits launch film"
        onError={() => setMissing(true)}
      >
        <source src="/launch.mp4" type="video/mp4" onError={() => setMissing(true)} />
      </video>
      {missing && (
        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-5">
          <span className="rounded-full bg-black/55 px-3.5 py-1.5 text-[13px] text-white/90 backdrop-blur">The launch film is on its way</span>
        </figcaption>
      )}
    </figure>
  );
}

// ---------- feature rows ----------

function Feature({ id, eyebrow, title, children, visual, flip }: { id: string; eyebrow: string; title: string; children: ReactNode; visual: ReactNode; flip?: boolean }) {
  return (
    <section id={id} className="border-t border-line py-20 sm:py-28">
      <Wrap className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
        <Reveal className={flip ? "md:order-2" : ""}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="font-serif text-[clamp(38px,5vw,56px)] leading-[1.02] tracking-[-0.02em]">{title}</h2>
          <div className="mt-6 space-y-4 text-[17px] leading-relaxed text-ink-2">{children}</div>
        </Reveal>
        <Reveal delay={0.08} className={`min-w-0 ${flip ? "md:order-1" : ""}`}>
          {visual}
        </Reveal>
      </Wrap>
    </section>
  );
}

function Features() {
  return (
    <>
      <Feature id="local" eyebrow="Local-first" title="Your data stays on your machine." visual={<LocalVisual />}>
        <p>
          Bits is a small daemon on your own computer. Every conversation is kept in a local SQLite journal, and what it
          knows lives in Markdown files you can open, edit or delete.
        </p>
        <p>
          There’s no Bits server. Only model calls leave your machine, and with a local model through Ollama or LM
          Studio, nothing does.
        </p>
      </Feature>

      <Feature id="memory" eyebrow="Smart memory" title="Remembers what matters, recalls it when needed." visual={<MemoryVisual />} flip>
        <p>
          Every step of every task is saved to the journal before the next one runs, so work survives a crash or a
          restart.
        </p>
        <p>
          While you’re away, long conversations are condensed into a summary, and lasting facts move into your memory
          files. When they matter again, Bits finds them with a quick search instead of carrying everything around.
        </p>
      </Feature>

      <Feature id="artifacts" eyebrow="Agentable artifacts" title="Little apps that any agent can use." visual={<ArtifactVisual />}>
        <p>
          When something is worth keeping, like a tracker, a list or a planner, Bits makes it an artifact: a small app
          with its own data, built with{" "}
          <a className="text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink" href={AGENTABLE} target="_blank" rel="noreferrer">
            Agentable UI
          </a>
          .
        </p>
        <p>
          Each artifact publishes its actions as WebMCP tools. You can tap them, Bits can run them, and so can any
          agent that speaks WebMCP: Claude, Codex or one you built.
        </p>
      </Feature>
    </>
  );
}

function LocalVisual() {
  const rows: { path: string; note: string; depth: number; folder?: boolean }[] = [
    { path: "memory/", note: "", depth: 0, folder: true },
    { path: "profile.md", note: "always in the prompt", depth: 1 },
    { path: "log/2026-10.md", note: "dated facts", depth: 1 },
    { path: "skills/research-report/SKILL.md", note: "loaded when needed", depth: 0 },
    { path: "routines/morning-brief.md", note: "runs at 8am", depth: 0 },
    { path: "state.db", note: "the journal", depth: 0 },
  ];
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <span className="font-mono text-[13px] text-ink">~/.bits</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent-ink">
          <Lock size={12} aria-hidden />
          On this computer
        </span>
      </div>
      <ul className="divide-y divide-line/70 px-2 py-1.5 font-mono text-[13px]">
        {rows.map((r) => (
          <li key={r.path} className="flex items-baseline gap-3 px-3 py-2.5" style={{ paddingLeft: 12 + r.depth * 20 }}>
            <span className={`min-w-0 flex-1 break-all ${r.folder ? "text-muted" : "text-ink"}`}>{r.path}</span>
            {r.note && <span className="hidden flex-none text-[12px] text-muted sm:inline">{r.note}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MemoryVisual() {
  return (
    <div className="relative flex flex-col gap-3">
      <div className="absolute top-8 bottom-8 left-[27px] w-px bg-line-2" aria-hidden />
      <MemoryStep n="1" title="Every step, journaled">
        <div className="flex flex-col gap-1.5 font-mono text-[12.5px]">
          {["web_search  “espresso grinder under $300”", "web_fetch   seriouseats.com/…", "present     comparison table"].map((l) => (
            <div key={l} className="flex items-center gap-2 text-ink-2">
              <Check size={13} className="flex-none text-success" aria-hidden />
              <span className="truncate">{l}</span>
            </div>
          ))}
        </div>
      </MemoryStep>
      <MemoryStep n="2" title="Condensed while you’re away">
        <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[14px] leading-relaxed text-ink-2">
          Wants an espresso grinder under $300. Picked the DF54. Weekly price check set for Mondays at 9.
        </p>
      </MemoryStep>
      <MemoryStep n="3" title="Recalled when it matters">
        <div className="font-mono text-[12.5px] text-muted">memory_search(“espresso”)</div>
        <div className="mt-2 rounded-xl border border-line px-3.5 py-2.5 text-[14px] text-ink-2">
          <span className="font-mono text-[12px] text-muted">2026-10-21 </span>
          Drinks flat whites; has a Breville Bambino <mark className="rounded bg-accent-soft-2 px-1 text-ink">espresso</mark> machine
        </div>
      </MemoryStep>
    </div>
  );
}

function MemoryStep({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <Panel className="relative flex gap-4 p-4 sm:p-5">
      <span className="relative z-10 grid h-6 w-6 flex-none place-items-center rounded-full bg-ink font-mono text-[12px] text-bg">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-2.5 text-[14px] font-semibold">{title}</div>
        {children}
      </div>
    </Panel>
  );
}

function ArtifactVisual() {
  const books = [
    { title: "The Overstory", author: "Richard Powers", status: "reading" },
    { title: "Piranesi", author: "Susanna Clarke", status: "to read" },
    { title: "Project Hail Mary", author: "Andy Weir", status: "done" },
  ];
  const tools = ["reading_list_state", "reading_list_add_book", "reading_list_mark_read"];
  return (
    <div className="flex flex-col gap-3">
      <Panel className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent-ink">
            <FileText size={16} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold">Reading list</div>
            <div className="text-[12.5px] text-muted">Books to read, reading and done.</div>
          </div>
        </div>
        <ul className="divide-y divide-line/70">
          {books.map((b) => (
            <li key={b.title} className="flex items-center gap-3 px-5 py-3 text-[14px]">
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
              <span className="hidden min-w-0 flex-1 truncate text-muted sm:block">{b.author}</span>
              <span
                className={`flex-none rounded-full px-2 py-0.5 text-[12px] ${
                  b.status === "done" ? "bg-[var(--a-green-soft)] text-success" : b.status === "reading" ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-muted"
                }`}
              >
                {b.status}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-[13px] font-semibold">WebMCP tools</span>
          <span className="font-mono text-[11.5px] text-muted">navigator.modelContext</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {tools.map((t) => (
            <code key={t} className="truncate rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-[12.5px] text-ink-2">
              {t}
            </code>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="mr-1 text-muted">Used by</span>
          {["You", "Bits", "Claude", "Codex", "Your agent"].map((a) => (
            <span key={a} className="rounded-full border border-line px-2.5 py-0.5 text-ink-2">
              {a}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ---------- connectors ----------

function Connectors() {
  const apps = [
    { name: "Gmail", icon: Mail },
    { name: "Calendar", icon: CalendarDays },
    { name: "Slack", icon: MessagesSquare },
    { name: "GitHub", icon: GitBranch },
    { name: "Drive", icon: HardDrive },
    { name: "Notion", icon: NotebookPen },
  ];
  return (
    <section id="connectors" className="border-t border-line bg-bg-2 py-20 sm:py-28">
      <Wrap>
        <Reveal className="max-w-[640px]">
          <Eyebrow>Connectors</Eyebrow>
          <h2 className="font-serif text-[clamp(38px,5vw,56px)] leading-[1.02] tracking-[-0.02em]">Your apps, one sign-in away.</h2>
          <p className="mt-6 text-[17px] leading-relaxed text-ink-2">
            One-click connectors for the apps you already use are on the way. Until then, you can connect any MCP
            server by hand in <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[14px]">~/.bits/connectors.json</code>.
          </p>
        </Reveal>
        <Reveal delay={0.08} className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {apps.map(({ name, icon: Icon }) => (
            <div key={name} className="flex flex-col gap-4 rounded-[18px] border border-line bg-surface p-4">
              <Icon size={20} className="text-muted" aria-hidden />
              <div>
                <div className="text-[15px] font-medium">{name}</div>
                <div className="mt-1 inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-muted">Coming soon</div>
              </div>
            </div>
          ))}
        </Reveal>
      </Wrap>
    </section>
  );
}

// ---------- enterprise / flexible ----------

function Flexible() {
  const items = [
    { icon: Cpu, title: "Any model", body: "Anthropic, OpenAI, or local models through Ollama and LM Studio. Switch with one setting." },
    {
      icon: Server,
      title: "Your infrastructure",
      body: "One Node process and a SQLite file. Run it on a laptop, a home server or your own cloud, with a token when it’s reachable beyond localhost.",
    },
    { icon: Bot, title: "Your agents", body: "Bits uses your tools over MCP, and its artifacts expose actions over WebMCP, so your own agents can work alongside it." },
    { icon: Scale, title: "Open source", body: "MIT licensed. Read every line, fork it, and ship it inside your company." },
  ];
  return (
    <section id="flexible" className="border-t border-line py-20 sm:py-28">
      <Wrap>
        <Reveal className="max-w-[640px]">
          <Eyebrow>For teams</Eyebrow>
          <h2 className="font-serif text-[clamp(38px,5vw,56px)] leading-[1.02] tracking-[-0.02em]">Bring your own models. Host it yourself.</h2>
        </Reveal>
        <div className="mt-12 grid gap-3 sm:grid-cols-2">
          {items.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 0.05}>
              <Panel className="h-full p-6 shadow-none">
                <Icon size={20} className="text-accent-ink" aria-hidden />
                <h3 className="mt-5 text-[17px] font-semibold">{title}</h3>
                <p className="mt-2 text-[15.5px] leading-relaxed text-ink-2">{body}</p>
              </Panel>
            </Reveal>
          ))}
        </div>
      </Wrap>
    </section>
  );
}

// ---------- install ----------

function Install() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL.map((l) => l.cmd).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <section id="install" className="border-t border-line bg-bg-2 py-20 sm:py-28">
      <Wrap className="grid gap-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
        <Reveal>
          <Eyebrow>Install</Eyebrow>
          <h2 className="font-serif text-[clamp(38px,5vw,56px)] leading-[1.02] tracking-[-0.02em]">Running in a minute.</h2>
          <p className="mt-6 text-[17px] leading-relaxed text-ink-2">
            Clone{" "}
            <a className="text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink" href={REPO} target="_blank" rel="noreferrer">
              the repo
            </a>
            , then run these from its folder. Bits needs Node 24+ and pnpm, and keeps its data in{" "}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[14px]">~/.bits</code>.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={DEMO} primary>
              Try the demo first
              <ArrowRight size={17} aria-hidden />
            </ButtonLink>
          </div>
        </Reveal>
        <Reveal delay={0.08} className="min-w-0">
          <div className="overflow-hidden rounded-[20px] border border-[#2a2833] bg-[#131218] text-[#efedf5] shadow-lift">
            <div className="flex items-center justify-between border-b border-[#2a2833] px-5 py-3">
              <span className="font-mono text-[12.5px] text-[#8d889c]">Quick start</span>
              <button
                type="button"
                onClick={copy}
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-[#c4c0d0] transition-colors hover:bg-white/10 hover:text-white"
              >
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <ol className="flex flex-col gap-4 px-5 py-5 font-mono text-[13.5px] leading-relaxed">
              {INSTALL.map((l) => (
                <li key={l.cmd} className="min-w-0">
                  <div className="flex gap-3">
                    <span className="select-none text-[#5c5869]" aria-hidden>
                      $
                    </span>
                    <span className="break-all">{l.cmd}</span>
                  </div>
                  {l.note && <div className="pl-6 text-[12.5px] text-[#8d889c]"># {l.note}</div>}
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </Wrap>
    </section>
  );
}

// ---------- footer ----------

function Footer() {
  return (
    <footer className="border-t border-line py-12">
      <Wrap className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Mascot size={26} still title="" />
          <p className="text-[14px] text-ink-2">
            <a className="hover:text-ink" href={IFH} target="_blank" rel="noreferrer">
              Interfaces for Humans
            </a>
            <span className="mx-2 text-faint" aria-hidden>
              ×
            </span>
            <a className="hover:text-ink" href={AGENTABLE} target="_blank" rel="noreferrer">
              Agentable UI
            </a>
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-ink-2" aria-label="Footer">
          <a className="hover:text-ink" href={DEMO}>
            Demo
          </a>
          <a className="hover:text-ink" href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a className="hover:text-ink" href={DOCS} target="_blank" rel="noreferrer">
            Docs
          </a>
          <span className="text-muted">MIT license</span>
        </nav>
      </Wrap>
    </footer>
  );
}
