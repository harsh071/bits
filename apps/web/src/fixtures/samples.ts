// Sample data shared by the dev fixtures page and the public demo (VITE_BITS_DEMO=1).
import type { Message, Part, RenderUIInput, UINode } from "@bits/protocol";

export const FX_ARTIFACT = "fx-reading-list-a1b2c3";

export const PRESENTS: { name: string; title?: string; program: string }[] = [
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


export const weekly = [
  { day: "Mon", focus: 3.5, meetings: 2 },
  { day: "Tue", focus: 2, meetings: 4.5 },
  { day: "Wed", focus: 5, meetings: 1 },
  { day: "Thu", focus: 4, meetings: 2.5 },
  { day: "Fri", focus: 6, meetings: 0.5 },
  { day: "Sat", focus: 1, meetings: 0 },
  { day: "Sun", focus: 0.5, meetings: 0 },
];

export const NODES: { name: string; node: UINode }[] = [
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
let convId = "fixture";
export const msg = (role: Message["role"], parts: Part[], extra: Partial<Message> = {}): Message => ({
  id: `m${++seq}`,
  conversationId: convId,
  seq,
  role,
  parts,
  turnId: role === "user" || role === "event" ? null : "t1",
  createdAt: Date.now(),
  ...extra,
});

export function sampleMessages(conversationId = "fixture"): Message[] {
  seq = 0;
  convId = conversationId;
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

