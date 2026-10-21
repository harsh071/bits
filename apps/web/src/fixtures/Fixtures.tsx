import { useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import type { Message, Part, RenderUIInput, UINode } from "@bits/protocol";
import { Mascot, type MascotState } from "../components/Mascot";
import { GenUIBlock } from "../genui";
import { Thread } from "../components/Thread";
import { Composer } from "../components/Composer";
import { EmptyState } from "../components/EmptyState";
import { buildBlocks } from "../lib/blocks";
import { useTheme } from "../store/theme";
import { useVoice } from "../voice/voice";
import { VoiceOverlay } from "../voice/VoiceOverlay";
import { installArtifactMock } from "./mockFetch";
import { ArtifactEmbed } from "../artifacts/ArtifactEmbed";

installArtifactMock();
const FX_ARTIFACT = "fx-reading-list-a1b2c3";

const PRESENTS: { name: string; title?: string; program: string }[] = [
  {
    name: "stats + callout",
    title: "August at a glance",
    program: `root = Stack([stats, note])
stats = StatGroup([rev, orders, refunds])
rev = Stat("Revenue", "$48.2k", "+6.1%", "up")
orders = Stat("Orders", "140", "+12", "up")
refunds = Stat("Refunds", "9", "-2", "down")
note = Callout("On track", "Revenue is ahead of target by 4%.", "success")`,
  },
  {
    name: "form with $ui + @Say",
    program: `root = Card("Dinner tonight", "Pick a few things and I’ll find recipes", [cuisine, guests, veg, go, note])
cuisine = Select("Cuisine", ["Italian", "Thai", "Mexican", "Japanese"], $ui.cuisine, "Any", change: @Set($ui.cuisine, $event))
guests = TextInput("Guests", $ui.guests, kind: "number", change: @Set($ui.guests, $event))
veg = Checkbox("Vegetarian", $ui.veg, change: @Set($ui.veg, $event))
go = Button("Find recipes", "primary", press: @Say("Find dinner recipes for tonight with my picks"))
note = Text("Your picks stay on this card.", "muted", when: $ui.cuisine)`,
  },
  {
    name: "RecordTable + KeyValue + Progress + List",
    title: "Trip prep",
    program: `root = Stack([table, facts, prog, todo])
table = RecordTable("Flights", [{key: "leg", label: "Leg"}, {key: "when", label: "When"}, {key: "price", label: "Price"}], [{leg: "YYZ → LIS", when: "Fri 18:05", price: "$612"}, {leg: "LIS → YYZ", when: "Mon 11:40", price: "$587"}])
facts = KeyValue([{key: "Hotel", value: "Memmo Alfama"}, {key: "Nights", value: 3}])
prog = Progress("Packing", 60, 100)
todo = List(["Passport", "Adapter", "Sunscreen"])`,
  },
  {
    name: "broken program (issues note)",
    program: `root = Stack([ok, bad])
ok = Text("This line renders fine.")
bad = Sparkle("not a component")`,
  },
];

const STATES: MascotState[] = ["idle", "thinking", "working", "listening", "speaking", "waiting", "offline"];

const weekly = [
  { day: "Mon", focus: 3.5, meetings: 2 },
  { day: "Tue", focus: 2, meetings: 4.5 },
  { day: "Wed", focus: 5, meetings: 1 },
  { day: "Thu", focus: 4, meetings: 2.5 },
  { day: "Fri", focus: 6, meetings: 0.5 },
  { day: "Sat", focus: 1, meetings: 0 },
  { day: "Sun", focus: 0.5, meetings: 0 },
];

const NODES: { name: string; node: UINode }[] = [
  {
    name: "card + grid + stat",
    node: {
      type: "card",
      title: "This week",
      subtitle: "Oct 20 – Oct 26",
      icon: "calendar",
      accent: "violet",
      children: [
        {
          type: "grid",
          columns: 3,
          children: [
            { type: "stat", label: "Focus time", value: "22h", delta: "+18%", trend: "up" },
            { type: "stat", label: "Meetings", value: "10.5h", delta: "-6%", trend: "down" },
            { type: "stat", label: "Workouts", value: "3", delta: "same", trend: "flat" },
          ],
        },
      ],
    },
  },
  { name: "chart · bar", node: { type: "chart", kind: "bar", title: "Hours per day", data: weekly, x: "day", series: ["focus", "meetings"] } },
  { name: "chart · line", node: { type: "chart", kind: "line", title: "Focus hours", data: weekly, x: "day", series: ["focus"] } },
  {
    name: "chart · area",
    node: {
      type: "chart",
      kind: "area",
      title: "BTC (USD)",
      data: Array.from({ length: 30 }, (_, i) => ({ d: `${i + 1}`, price: Math.round(61000 + Math.sin(i / 3) * 2400 + i * 140) })),
      x: "d",
      series: ["price"],
    },
  },
  {
    name: "table",
    node: {
      type: "table",
      columns: ["Grinder", "Price", "Burrs", "Score"],
      rows: [
        ["Baratza Encore ESP", "$199", "40mm conical", 8.6],
        ["Fellow Opus", "$195", "40mm conical", 8.2],
        ["DF54", "$249", "54mm flat", 9.1],
        ["Eureka Mignon Notte", "$299", "50mm flat", 8.8],
      ],
    },
  },
  {
    name: "list",
    node: {
      type: "list",
      items: [
        { title: "Dentist", subtitle: "Dr. Alvarez · 2nd floor", meta: "Tue 9:30", icon: "health" },
        { title: "Flight to Lisbon", subtitle: "TP 202 · Seat 14A", meta: "Fri 18:05", icon: "plane" },
        { title: "Read: The Overstory", subtitle: "Ch. 12–14", meta: "Sun", icon: "book", href: "https://example.com" },
      ],
    },
  },
  { name: "list · ordered", node: { type: "list", ordered: true, items: [{ title: "Book flights" }, { title: "Reserve hotel", subtitle: "Near Alfama" }, { title: "Pack" }] } },
  {
    name: "timeline",
    node: {
      type: "timeline",
      items: [
        { time: "08:00", title: "Morning brief", detail: "Weather, calendar, 3 headlines", done: true },
        { time: "10:30", title: "Design review", done: true },
        { time: "13:00", title: "Lunch with Sam", detail: "Tartine, Guerrero St." },
        { time: "17:30", title: "Gym — legs" },
      ],
    },
  },
  { name: "checklist", node: { type: "checklist", items: [{ text: "Renew passport", done: true }, { text: "Call mom" }, { text: "Pay electricity bill" }] } },
  {
    name: "callouts",
    node: {
      type: "stack",
      gap: "sm",
      children: [
        { type: "callout", tone: "info", title: "Heads up", text: "Your **morning brief** runs at 8am on weekdays." },
        { type: "callout", tone: "success", text: "Saved to memory." },
        { type: "callout", tone: "warning", title: "Rain at 5pm", text: "Bring an umbrella for the gym walk." },
        { type: "callout", tone: "danger", text: "The bill is **3 days overdue**." },
      ],
    },
  },
  {
    name: "row + badges + progress",
    node: {
      type: "stack",
      children: [
        { type: "row", gap: "sm", children: [
          { type: "badge", text: "violet", accent: "violet" }, { type: "badge", text: "blue", accent: "blue" }, { type: "badge", text: "green", accent: "green" },
          { type: "badge", text: "amber", accent: "amber" }, { type: "badge", text: "rose", accent: "rose" }, { type: "badge", text: "slate", accent: "slate" },
        ] },
        { type: "progress", value: 68, label: "Reading goal · 34 of 50 books" },
        { type: "divider" },
        { type: "heading", text: "Heading level 1", level: 1 },
        { type: "heading", text: "Heading level 2", level: 2 },
        { type: "heading", text: "Heading level 3", level: 3 },
        { type: "text", text: "Plain **markdown** text with a [link](https://example.com) and `code`." },
        { type: "text", text: "Muted helper text.", tone: "muted" },
      ],
    },
  },
  {
    name: "link + image",
    node: {
      type: "grid",
      columns: 2,
      children: [
        { type: "link", href: "https://www.seriouseats.com/best-coffee-grinders", title: "The Best Coffee Grinders, Tested", description: "We tested 20 burr grinders to find the best for espresso and drip." },
        { type: "image", src: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800", alt: "Coffee", caption: "Morning ritual" },
      ],
    },
  },
  { name: "actions", node: { type: "actions", buttons: [{ label: "Book it", message: "Book the DF54", style: "primary" }, { label: "Show more options", message: "Show more", style: "secondary" }] } },
  { name: "cards · accents", node: { type: "grid", columns: 3, children: (["blue", "green", "amber", "rose", "slate", "violet"] as const).map((a, i) => ({ type: "card", title: `${a[0].toUpperCase()}${a.slice(1)} card`, subtitle: "With an icon", icon: ["cloud", "leaf", "sun", "heart", "server", "sparkles"][i], accent: a, children: [{ type: "text", text: "Card body.", tone: "muted" }] }) as UINode) } },
  { name: "malformed (should not crash)", node: { type: "chart", kind: "bar", data: null, x: 3, series: "nope" } as unknown as UINode },
  { name: "unknown type", node: { type: "hologram", foo: 1 } as unknown as UINode },
];

let seq = 0;
const msg = (role: Message["role"], parts: Part[], extra: Partial<Message> = {}): Message => ({
  id: `m${++seq}`,
  conversationId: "fixture",
  seq,
  role,
  parts,
  turnId: role === "user" || role === "event" ? null : "t1",
  createdAt: Date.now(),
  ...extra,
});

function sampleMessages(): Message[] {
  seq = 0;
  const comparison: RenderUIInput = {
    title: "Espresso grinders under $300",
    ui: { type: "stack", children: [NODES[4].node, { type: "callout", tone: "success", title: "My pick", text: "**DF54** — flat burrs, great for espresso, $249." }, NODES[12].node] },
  };
  return [
    msg("event", [{ type: "text", text: "Morning brief routine ran" }], { meta: { source: "routine" } }),
    msg("user", [{ type: "text", text: "Research the best espresso grinder under $300 and show me a comparison" }]),
    msg("assistant", [
      { type: "text", text: "On it — let me look around." },
      { type: "tool-call", toolCallId: "c1", toolName: "web_search", input: { query: "best espresso grinder under $300 2026" } },
      { type: "tool-call", toolCallId: "c2", toolName: "web_search", input: { query: "DF54 vs Encore ESP review" } },
    ]),
    msg("tool", [
      { type: "tool-result", toolCallId: "c1", toolName: "web_search", output: { results: [1, 2, 3] } },
      { type: "tool-result", toolCallId: "c2", toolName: "web_search", output: { results: [1, 2, 3, 4, 5] } },
    ]),
    msg("assistant", [
      { type: "tool-call", toolCallId: "c3", toolName: "web_fetch", input: { url: "https://www.seriouseats.com/best-coffee-grinders" } },
      { type: "tool-call", toolCallId: "c4", toolName: "memory_search", input: { query: "coffee preferences" } },
    ]),
    msg("tool", [
      { type: "tool-result", toolCallId: "c3", toolName: "web_fetch", output: "…page text…" },
      { type: "tool-result", toolCallId: "c4", toolName: "memory_search", output: { matches: [] }, isError: true },
    ]),
    msg("assistant", [
      { type: "text", text: "Here’s how the top picks compare. You mentioned you mostly drink **flat whites**, so I weighted espresso performance higher." },
      { type: "tool-call", toolCallId: "c5", toolName: "render_ui", input: comparison },
    ]),
    msg("user", [{ type: "text", text: "Nice. Set up a weekly price check and save it to my notes." }], { meta: { source: "voice" } }),
    msg("assistant", [
      { type: "tool-call", toolCallId: "c6", toolName: "routine_create", input: { name: "grinder-price-check", schedule: "0 9 * * 1" } },
      { type: "tool-call", toolCallId: "c7", toolName: "write_file", input: { path: "~/notes/grinders.md", content: "# Grinders\n…" } },
      { type: "tool-call", toolCallId: "c8", toolName: "mcp__notion__create_page", input: { title: "Grinders" } },
    ]),
    msg("tool", [
      { type: "tool-result", toolCallId: "c6", toolName: "routine_create", output: { ok: true } },
      { type: "tool-result", toolCallId: "c7", toolName: "write_file", output: { status: "needs_approval", approvalId: "ap1", reason: "Writes outside the Bits home folder." } },
    ]),
    msg("assistant", [
      { type: "text", text: "I also made you a reading list you can keep using." },
      { type: "tool-call", toolCallId: "c10", toolName: "present", input: { title: PRESENTS[0].title, program: PRESENTS[0].program } },
      { type: "tool-call", toolCallId: "c11", toolName: "artifact_create", input: { title: "Reading list", kind: "list" } },
    ]),
    msg("tool", [
      { type: "tool-result", toolCallId: "c10", toolName: "present", output: { ok: true } },
      { type: "tool-result", toolCallId: "c11", toolName: "artifact_create", output: { id: FX_ARTIFACT, title: "Reading list" } },
    ]),
    msg("assistant", [
      { type: "tool-call", toolCallId: "c12", toolName: "artifact_create", input: { title: "Habit tracker", kind: "tracker" } },
    ]),
    msg("assistant", [
      { type: "tool-call", toolCallId: "c9", toolName: "ask_user", input: { question: "Which notes app should I keep this in?", options: ["Notion", "Apple Notes", "Just Bits memory"] } },
    ]),
  ];
}

export default function Fixtures() {
  const { dark, cycle } = useTheme();
  const [sent, setSent] = useState<string[]>([]);
  const messages = useMemo(sampleMessages, []);
  const blocks = useMemo(() => buildBlocks(messages, {}), [messages]);
  const liveBlocks = useMemo(
    () =>
      buildBlocks(
        [msg("user", [{ type: "text", text: "Plan my week" }], { id: "lu" }), msg("assistant", [{ type: "tool-call", toolCallId: "l1", toolName: "read_file", input: { path: "calendar/week.ics" } }], { id: "la", turnId: "t9" })],
        {
          live: { turnId: "t9", text: "Here’s a first pass at your week. Monday looks **light**, so I’d put deep work there and" },
          runningTurnId: "t9",
          pending: [{ id: "p1", conversationId: "x", text: "Also keep Friday afternoon free", source: "app", createdAt: Date.now(), status: "failed" }],
        },
      ),
    [],
  );
  const onSend = (t: string) => setSent((s) => [...s, t]);

  return (
    <div className="min-h-dvh bg-bg pb-24">
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-xl sm:px-8">
        <Mascot size={28} />
        <div className="font-serif text-[22px]">Bits · fixtures</div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() =>
            useVoice.setState({
              active: true,
              phase: "speaking",
              userCaption: "What's the weather like tomorrow?",
              botCaption: "Tomorrow looks **crisp and sunny** — a high of 14°, with a light breeze in the afternoon.",
              error: null,
            })
          }
          className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2"
        >
          Preview voice
        </button>
        <button type="button" onClick={cycle} aria-label="Toggle theme" className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink">
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>

      <VoiceOverlay />
      <div className="mx-auto max-w-[1100px] px-4 sm:px-8">
        <h2 className="mt-10 mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Mascot states</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {STATES.map((s) => (
            <div key={s} className="flex flex-col items-center gap-3 rounded-[18px] border border-line bg-surface py-5">
              <Mascot state={s} size={64} level={() => 0.3 + 0.3 * Math.sin(performance.now() / 160)} />
              <span className="text-[12.5px] text-muted">{s}</span>
            </div>
          ))}
        </div>

        <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div className="min-w-0">
            <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Thread (finished turn, approval, ask_user waiting)</h2>
            <Thread blocks={blocks} onSend={onSend} waiting />
            <h2 className="mt-12 mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Live turn + failed send</h2>
            <Thread blocks={liveBlocks} onSend={onSend} running activity="Reading your calendar" />
            <div className="mt-8">
              <Composer onSend={onSend} onMic={() => {}} />
            </div>
            <div className="mt-3">
              <Composer onSend={onSend} running onStop={() => {}} compact placeholder="Compact (overlay) composer, running" />
            </div>
            {sent.length > 0 && <div className="mt-3 text-[12.5px] text-muted">Sent: {sent.join(" · ")}</div>}
            <h2 className="mt-12 mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Empty state</h2>
            <div className="rounded-[22px] border border-line">
              <EmptyState onPick={onSend} compact />
            </div>
          </div>
          <div className="min-w-0">
            <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Agentable · present</h2>
            <div className="mb-12 flex flex-col gap-8">
              {PRESENTS.map((p) => (
                <div key={p.name}>
                  <div className="mb-2 font-mono text-[11.5px] text-faint">{p.name}</div>
                  <GenUIBlock part={{ type: "tool-call", toolCallId: p.name, toolName: "present", input: { title: p.title, program: p.program } }} onAction={onSend} />
                </div>
              ))}
            </div>
            <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Artifact (mocked fetch)</h2>
            <div className="mb-12">
              <ArtifactEmbed id={FX_ARTIFACT} />
            </div>
            <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Legacy render_ui catalog</h2>
            <div className="flex flex-col gap-8">
              {NODES.map(({ name, node }) => (
                <div key={name}>
                  <div className="mb-2 font-mono text-[11.5px] text-faint">{name}</div>
                  <GenUIBlock part={{ type: "tool-call", toolCallId: name, toolName: "render_ui", input: { ui: node } }} onAction={onSend} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
