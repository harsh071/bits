// Shared contract between the Bits daemon and every client (web, desktop overlay, mobile, channels).
// The database is the source of truth. Live events only say "something changed" (plus optional
// ephemeral token deltas for nice streaming); clients always fetch real data by sequence number.

// ---------- Messages ----------

export type Role = "user" | "assistant" | "tool" | "event";

export type TextPart = { type: "text"; text: string };
export type ReasoningPart = { type: "reasoning"; text: string };
export type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
};
export type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
  isError?: boolean;
};
export type FilePart = { type: "file"; url: string; mediaType: string; name?: string };

export type Part = TextPart | ReasoningPart | ToolCallPart | ToolResultPart | FilePart;

export interface Message {
  id: string; // client-generated for user messages (makes retries safe)
  conversationId: string;
  seq: number; // monotonically increasing per conversation
  role: Role;
  parts: Part[];
  turnId?: string | null;
  createdAt: number;
  meta?: {
    source?: "app" | "voice" | "telegram" | "routine" | "webhook" | "system" | "artifact";
    artifact?: string;
    routine?: string;
    steering?: boolean; // arrived while a turn was running
    summary?: boolean; // compaction marker
  } | null;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastSeq: number;
  status: TurnStatus | "idle";
}

// ---------- Turns ----------

export type TurnStatus =
  | "queued"
  | "running"
  | "waiting" // paused on approval or ask_user
  | "done"
  | "failed"
  | "cancelled";

export interface Turn {
  id: string;
  conversationId: string;
  status: TurnStatus;
  trigger: "message" | "routine" | "webhook" | "resume";
  steps: number;
  error?: string | null;
  /** Latest short status label ("Searching the web"), when the turn is live. */
  activity?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Approval {
  id: string;
  turnId: string;
  conversationId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  reason: string; // why it needs a human (from the auto-reviewer)
  status: "pending" | "approved" | "denied";
  createdAt: number;
}

// ---------- Live events (SSE: GET /api/events) ----------

export type ServerEvent =
  | { type: "hello"; serverTime: number }
  | { type: "changed"; conversationId: string; seq: number }
  | { type: "conversations" } // list changed
  | { type: "turn"; conversationId: string; turnId: string; status: TurnStatus; activity?: string }
  | {
      // Ephemeral streaming text. Lossy by design: the persisted message wins.
      type: "delta";
      conversationId: string;
      turnId: string;
      text: string;
    }
  | { type: "approval"; approval: Approval }
  | { type: "memory" } // memory/skills/routines files changed
  | { type: "artifact"; id: string; version: number; dataVersion: number } // refetch GET /api/artifacts/:id
  | { type: "artifacts" } // list changed
  | { type: "connectors" } // connector list or status changed: refetch GET /api/connectors
  | { type: "channels" } // a channel (Telegram) was set up, paired or removed: refetch GET /api/channels/telegram
  | { type: "ping" };

// ---------- Generative UI ----------
// The agent calls the `render_ui` tool with a tree of nodes from this fixed, safe catalog.
// Clients render tool-call parts named "render_ui" using input.ui.

export type UINode =
  | { type: "stack"; gap?: "sm" | "md" | "lg"; children: UINode[] }
  | { type: "row"; gap?: "sm" | "md" | "lg"; wrap?: boolean; children: UINode[] }
  | { type: "grid"; columns?: 2 | 3 | 4; children: UINode[] }
  | { type: "card"; title?: string; subtitle?: string; icon?: string; accent?: Accent; children?: UINode[] }
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "text"; text: string; tone?: "default" | "muted" } // markdown allowed
  | { type: "stat"; label: string; value: string; delta?: string; trend?: "up" | "down" | "flat" }
  | { type: "list"; ordered?: boolean; items: { title: string; subtitle?: string; meta?: string; icon?: string; href?: string }[] }
  | { type: "table"; columns: string[]; rows: (string | number)[][] }
  | {
      type: "chart";
      kind: "bar" | "line" | "area";
      data: Record<string, string | number>[];
      x: string;
      series: string[];
      title?: string;
    }
  | { type: "timeline"; items: { time: string; title: string; detail?: string; done?: boolean }[] }
  | { type: "checklist"; items: { text: string; done?: boolean }[] }
  | { type: "image"; src: string; alt?: string; caption?: string }
  | { type: "link"; href: string; title: string; description?: string; image?: string }
  | { type: "callout"; tone?: "info" | "success" | "warning" | "danger"; title?: string; text: string }
  | { type: "badge"; text: string; accent?: Accent }
  | { type: "progress"; value: number; label?: string } // 0..100
  | { type: "divider" }
  | {
      // Each button sends `message` back to the agent as if the user typed it.
      type: "actions";
      buttons: { label: string; message: string; style?: "primary" | "secondary" }[];
    };

export type Accent = "violet" | "blue" | "green" | "amber" | "rose" | "slate";

export interface RenderUIInput {
  title?: string;
  ui: UINode;
}

export interface AskUserInput {
  question: string;
  options?: string[];
}

// ---------- Agentable generative UI ----------
// Bits renders model-written UI with Agentable (@agentable-ui/*): programs in Agentable Lang,
// rendered by @agentable-ui/genui's <Renderer> with the @agentable-ui/ui catalog.

/** Input of the `present` tool: an inline, one-off view in the conversation. */
export interface PresentInput {
  title?: string;
  program: string; // Agentable Lang
}

// ---------- Artifacts ----------
// An artifact is a small persistent app Bits makes for you (a trip planner, habit tracker, reading list…).
//   view    — an Agentable Lang program; binds $data.* (the artifact's saved data) and $ui.* (local state)
//   data    — JSON the artifact keeps; changes only through actions (or Bits' own artifact tools)
//   actions — declared, data-only operations. Each one is at once a button handler (@Tool(name, args)),
//             a tool Bits can call from the daemon, and a WebMCP tool any browser agent can call.
// Stored as files in ~/.bits/artifacts/<id>/ (artifact.json, view.agl, data.json, history/).

export type DataOp =
  | { op: "set"; path: string; value: unknown }
  | { op: "merge"; path: string; value: Record<string, unknown> }
  | { op: "push"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "increment"; path: string; by?: number }
  | { op: "toggle"; path: string };
// Paths: "items", "trip.stops", "items[id=abc].done", "items[id=$input.id]".
// Values may reference "$input", "$input.field", "$id" (a fresh id) and "$now" (ISO time).

export interface ArtifactAction {
  description: string;
  input?: Record<string, unknown>; // JSON Schema for the action's input object
  ops: DataOp[];
  /** Ask before an agent (not a person clicking) runs it. */
  confirm?: boolean;
  /** Wake Bits with a message when someone runs this action (e.g. a form "submit"). */
  notify?: boolean;
}

export interface ArtifactMeta {
  id: string;
  title: string;
  kind: string; // free-form use-case type: "tracker", "planner", "list", "dashboard", "form"…
  description: string;
  icon?: string;
  conversationId: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  actions: Record<string, ArtifactAction>;
}

export interface Artifact extends ArtifactMeta {
  program: string;
  data: Record<string, unknown>;
}

export interface ArtifactActivity {
  at: number;
  action: string;
  input: unknown;
  by: "person" | "bits" | "agent"; // agent = an external WebMCP agent
}

// ---------- REST shapes ----------

export interface SendMessageBody {
  id: string; // client-generated; server drops duplicates
  text: string;
  source?: "app" | "voice" | "telegram";
}

export interface SendMessageResult {
  message: Message;
  duplicate: boolean;
  turnId: string | null;
  steering: boolean;
}

export interface MemoryOverview {
  home: string;
  profile: string;
  logs: { month: string; lines: number }[];
  skills: { name: string; description: string }[];
  routines: { name: string; schedule: string; enabled: boolean; nextRunAt: number | null; lastRunAt: number | null; prompt: string }[];
}

export interface VoiceConfig {
  stt: "openai" | "browser";
  tts: "openai" | "cartesia" | "browser";
}

export interface HealthInfo {
  ok: true;
  name: "bits";
  version: string;
  model: string;
  home: string;
}

// ----- connectors (MCP servers) -----

export type ConnectorAuth = "oauth" | "key" | "none";

/** One-click connector templates. `key` presets need an API key the user creates with the provider. */
export interface ConnectorPreset {
  id: string;
  name: string;
  blurb: string;
  auth: ConnectorAuth;
  /** Fixed server URL; absent when the user pastes their own (e.g. Composio). */
  url?: string;
  urlHint?: string;
  /** Where to create the key, and what to call it. */
  keyUrl?: string;
  keyLabel?: string;
  docsUrl?: string;
}

export type ConnectorState = "connected" | "connecting" | "needs_auth" | "error" | "disabled";

export interface ConnectorInfo {
  name: string;
  kind: "remote" | "local";
  /** Remote: origin + path of the server (never headers). Local: the command name. */
  target: string;
  auth: ConnectorAuth;
  preset?: string;
  state: ConnectorState;
  tools: { name: string; description: string; risk: "read" | "write" | "external" | "destructive" }[];
  error?: string;
  /** Secret names this connector needs that aren't in the vault yet. */
  missingSecrets: string[];
}

export interface ConnectorsOverview {
  connectors: ConnectorInfo[];
  presets: ConnectorPreset[];
  /** Names only. Values never leave the daemon. */
  secrets: string[];
  /** Where the vault key lives. */
  keyStore: "keychain" | "secret-service" | "file";
  configPath: string;
}

export interface AddConnectorBody {
  name: string;
  preset?: string;
  url?: string;
  auth?: ConnectorAuth;
  /** For key auth: the API key. Stored in the vault, never in connectors.json. */
  apiKey?: string;
}

// ----- channels (reach Bits away from this machine) -----

/**
 * Telegram: a bot you make with @BotFather. The daemon long-polls Telegram (no public URL needed),
 * answers only the one chat that paired with it, and sends back replies, routine results and approvals.
 */
export interface TelegramStatus {
  configured: boolean;
  /** The bot's @username, once the token checked out. */
  bot: string | null;
  /** Who it's paired with. Only this chat can talk to Bits. */
  paired: { name: string } | null;
  /** While unpaired: open this link on your phone (t.me/<bot>?start=<code>) to pair. */
  pairUrl: string | null;
  error: string | null;
}
