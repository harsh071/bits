// Sample state for the public demo. Built from the dev fixtures so the demo shows the same UI.
import type { Approval, Artifact, Conversation, MemoryOverview, Message, Part, UINode } from "@bits/protocol";
import { NODES, PRESENTS, sampleMessages } from "../fixtures/samples";
import { sampleReadingList } from "../fixtures/dataOps";

export const READING_LIST = "reading-list-a1b2c3";
export const TRIP = "lisbon-trip-k3m9q2";

const node = (name: string) => NODES.find((n) => n.name === name)!.node;
export const present = (name: string) => {
  const p = PRESENTS.find((x) => x.name === name)!;
  return { title: p.title, program: p.program };
};

const HOUR = 3_600_000;

let seq = 0;
function m(conversationId: string, role: Message["role"], parts: Part[], extra: Partial<Message> = {}, ago = 0): Message {
  return {
    id: `${conversationId}-m${++seq}`,
    conversationId,
    seq,
    role,
    parts,
    turnId: role === "user" || role === "event" ? null : `${conversationId}-t1`,
    createdAt: Date.now() - ago,
    ...extra,
  };
}

export function demoConversations(): { conversations: Conversation[]; messages: Record<string, Message[]> } {
  const now = Date.now();

  seq = 0;
  const home: Message[] = [
    m("home", "event", [{ type: "text", text: "Morning brief routine ran" }], { meta: { source: "routine", routine: "morning-brief" } }, 3 * HOUR),
    m(
      "home",
      "assistant",
      [
        { type: "text", text: "Good morning! Here’s your day. The design review moved to **10:30**, so you have a clean focus block until then." },
        {
          type: "tool-call",
          toolCallId: "h1",
          toolName: "render_ui",
          input: { title: "Today", ui: { type: "stack", children: [node("timeline"), node("checklist")] } satisfies UINode },
        },
      ],
      {},
      3 * HOUR,
    ),
    m("home", "user", [{ type: "text", text: "Thanks! What’s on my reading list?" }], {}, 2 * HOUR),
    m(
      "home",
      "assistant",
      [
        {
          type: "text",
          text: "Here it is. You can add books or mark them read right in the card. Any agent on this page can use it too, through WebMCP.",
        },
        { type: "tool-call", toolCallId: "h2", toolName: "artifact_create", input: { title: "Reading list", kind: "list" } },
      ],
      {},
      2 * HOUR,
    ),
    m("home", "tool", [{ type: "tool-result", toolCallId: "h2", toolName: "artifact_create", output: { id: READING_LIST, title: "Reading list" } }], {}, 2 * HOUR),
  ];

  // The fixture thread: research, generative UI, an approval and a pending question.
  const grinders = sampleMessages("grinders").filter((x) => !x.parts.some((p) => p.type === "tool-call" && p.toolCallId === "c12"));
  for (const x of grinders) {
    // Point the fixture's artifact at the demo's reading list, and drop the off-topic revenue card.
    x.parts = x.parts
      .filter((p) => !((p.type === "tool-call" || p.type === "tool-result") && p.toolCallId === "c10"))
      .map((p) => (p.type === "tool-result" && p.toolName === "artifact_create" ? { ...p, output: { id: READING_LIST, title: "Reading list" } } : p));
  }
  grinders.forEach((x, i) => {
    x.id = `grinders-${x.id}`;
    x.seq = i + 1;
    x.createdAt = now - 26 * HOUR + i * 60_000;
    if (x.turnId) x.turnId = "grinders-t1";
  });

  seq = 0;
  const week: Message[] = [
    m("week", "user", [{ type: "text", text: "How did my week go? Plan the next one around my workouts." }], {}, 50 * HOUR),
    m(
      "week",
      "assistant",
      [
        { type: "tool-call", toolCallId: "w1", toolName: "read_file", input: { path: "calendar/week.ics" } },
        { type: "tool-call", toolCallId: "w2", toolName: "memory_search", input: { query: "workout schedule" } },
      ],
      {},
      50 * HOUR,
    ),
    m(
      "week",
      "tool",
      [
        { type: "tool-result", toolCallId: "w1", toolName: "read_file", output: "BEGIN:VCALENDAR…" },
        { type: "tool-result", toolCallId: "w2", toolName: "memory_search", output: { matches: 2 } },
      ],
      {},
      50 * HOUR,
    ),
    m(
      "week",
      "assistant",
      [
        { type: "text", text: "A good week: focus time is up **18%**. Friday was your best day, so I kept next Friday morning clear for deep work." },
        { type: "tool-call", toolCallId: "w3", toolName: "render_ui", input: { ui: { type: "stack", children: [node("card + grid + stat"), node("chart · bar")] } } },
        {
          type: "tool-call",
          toolCallId: "w4",
          toolName: "render_ui",
          input: {
            ui: {
              type: "actions",
              buttons: [
                { label: "Plan my day", message: "Plan my day", style: "primary" },
                { label: "Show my reading list", message: "Show my reading list", style: "secondary" },
              ],
            },
          },
        },
      ],
      {},
      50 * HOUR,
    ),
  ];

  const conv = (id: string, title: string, msgs: Message[], status: Conversation["status"]): Conversation => ({
    id,
    title,
    createdAt: msgs[0].createdAt,
    updatedAt: msgs[msgs.length - 1].createdAt,
    lastSeq: msgs[msgs.length - 1].seq,
    status,
  });

  return {
    conversations: [conv("home", "Home", home, "done"), conv("grinders", "Espresso grinders", grinders, "waiting"), conv("week", "Week review", week, "done")],
    messages: { home, grinders, week },
  };
}

export function demoApprovals(): Approval[] {
  return [
    {
      id: "ap1",
      turnId: "grinders-t1",
      conversationId: "grinders",
      toolCallId: "c7",
      toolName: "write_file",
      input: { path: "~/notes/grinders.md", content: "# Grinders\n…" },
      reason: "Writes outside the Bits home folder.",
      status: "pending",
      createdAt: Date.now() - 25 * HOUR,
    },
  ];
}

export function demoArtifacts(): (Artifact & { dataVersion: number })[] {
  // The sample is plain JSON (shared with a Node mock), so its op names are widened to string.
  const reading = sampleReadingList(READING_LIST, "home") as unknown as Artifact & { dataVersion: number };
  const trip = present("RecordTable + KeyValue + Progress + List");
  return [
    reading,
    {
      id: TRIP,
      title: "Lisbon trip",
      kind: "planner",
      description: "Flights, hotel and packing for Lisbon.",
      icon: "plane",
      conversationId: "home",
      version: 1,
      dataVersion: 1,
      createdAt: Date.now() - 5 * 24 * HOUR,
      updatedAt: Date.now() - 30 * HOUR,
      actions: {},
      program: trip.program,
      data: {},
    },
  ];
}

const PROFILE = `# Profile

## About me
- Product designer in Toronto; works from home Mondays and Fridays
- Drinks flat whites; has a Breville Bambino

## Preferences
- Mornings are for deep work; no meetings before 10
- Short answers, with a table when comparing options

## People & places
- Sam: best friend, lunch most Wednesdays
- Gym: legs on Tuesdays, run on Thursdays

## Ongoing projects
- Trip to Lisbon in March
- Reading 50 books this year
`;

const LOGS: Record<string, string[]> = {
  "2026-10": [
    "2026-10-21: Wants a weekly price check on the DF54 grinder",
    "2026-10-20: Design review moved to 10:30 on Tuesdays",
    "2026-10-18: Finished Project Hail Mary; loved it",
    "2026-10-14: Prefers aisle seats on flights",
    "2026-10-09: Booked Lisbon flights (TP 202, Mar 13)",
    "2026-10-03: Allergic to cashews",
  ],
  "2026-09": [
    "2026-09-28: Started The Overstory",
    "2026-09-22: Runs 5k on Thursdays before work",
    "2026-09-15: Sam's birthday is Nov 2",
    "2026-09-04: Moved to the new studio on Ossington",
  ],
};

export function demoMemory(): MemoryOverview {
  const tomorrow8 = new Date();
  tomorrow8.setDate(tomorrow8.getDate() + 1);
  tomorrow8.setHours(8, 0, 0, 0);
  const today8 = new Date();
  today8.setHours(8, 0, 0, 0);
  return {
    home: "~/.bits",
    profile: PROFILE,
    logs: Object.entries(LOGS).map(([month, lines]) => ({ month, lines: lines.length })),
    skills: [
      {
        name: "research-report",
        description: "Use this when the user asks to research, compare, or evaluate options and wants a recommendation.",
      },
    ],
    routines: [
      {
        name: "morning-brief",
        schedule: "0 8 * * 1-5",
        enabled: true,
        nextRunAt: tomorrow8.getTime(),
        lastRunAt: today8.getTime(),
        prompt: "Give me a short brief for today: weather, what's due, and one thing worth reading.",
      },
    ],
  };
}

export function demoLog(month: string) {
  const lines = LOGS[month] ?? [];
  return `# ${month}\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
}

export const DEMO_SKILL = `# Research report

1. Clarify the decision and constraints from memory first (budget, location, preferences in profile.md).
2. Run 2–4 focused web searches; open the 3–6 most authoritative pages.
3. Present a comparison table (options × criteria) and a card with your pick and why.
4. List sources. Keep the written answer to 3–5 sentences.
5. Save any new durable preference you learned with memory_remember.
`;
