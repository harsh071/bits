# Bits daemon API (v0)

Base URL: `http://127.0.0.1:7077` (env `BITS_PORT`). All types live in `packages/protocol/src/index.ts`.
In dev, the web app (Vite, port 5173) proxies `/api` to the daemon.

Auth: if `BITS_TOKEN` is set, send `Authorization: Bearer <token>` (or `?token=` for SSE). Unset on localhost by default.

## Live updates

`GET /api/events` — Server-Sent Events. Each `data:` line is a JSON `ServerEvent`.

- `changed {conversationId, seq}` → fetch `GET /api/conversations/:id/messages?after=<your last seq>`
  and append in seq order. If you detect a gap, refetch everything after your last known seq.
- `delta {conversationId, turnId, text}` → ephemeral streaming text for the assistant message in
  progress. Show it as a "live" bubble; drop it once the persisted message arrives
  (or when a `turn` event with a terminal status arrives).
- `turn {conversationId, turnId, status, activity?}` → status of the running turn
  (`queued | running | waiting | done | failed | cancelled`). `activity` is a short human label
  like "Searching the web" — show next to the mascot.
- `approval {approval}` → a pending approval card should appear (also visible via tool-call parts).
- `memory` → memory/skills/routines changed; refetch `GET /api/memory`.
- `conversations` → conversation list changed.

Signals carry no authoritative data, so losing one is harmless. Reconnect with backoff and
refetch on reconnect.

## Conversations & messages

- `GET /api/conversations` → `Conversation[]` (most recent first). A default "Home" conversation always exists (`id = "home"`).
- `POST /api/conversations` `{title?}` → `Conversation`
- `GET /api/conversations/:id/messages?after=<seq>&limit=<n>` → `{ messages: Message[], lastSeq: number, turn: Turn | null }`
  (`turn` is the latest non-terminal turn, if any)
- `POST /api/conversations/:id/messages` `SendMessageBody` → `SendMessageResult`
  - Client generates `id` (e.g. `crypto.randomUUID()`) and shows the message immediately (optimistic).
    Retrying with the same id is safe.
  - If a turn is already running, the message *steers* it (`steering: true`), the agent reads it
    between steps.
- `POST /api/conversations/:id/cancel` → stops the running turn.

## Rendering message parts

`Message.role`:
- `user` → user bubble (text parts). `meta.source === "voice"` → small mic icon.
- `assistant` → text parts are markdown. `tool-call` parts:
  - `toolName === "render_ui"` → render `input.ui` (a `UINode`) with the generative UI catalog. `input.title` optional.
  - `toolName === "ask_user"` → show `input.question` + option chips; clicking a chip sends it as a user message.
  - anything else → compact "activity chip" (icon + friendly verb + short arg), expandable to show input and the matching result (find the `tool-result` part with the same `toolCallId` in later `tool` role messages).
- `tool` → do not render as a bubble; only used to pair results with calls (results with `isError` show a red dot on the chip; result `{status:"needs_approval", approvalId}` means the call awaits approval).
- `event` → small centered system line (e.g. "Morning brief routine ran", "Conversation summarized").

## Approvals

- `GET /api/approvals?status=pending` → `Approval[]`
- `POST /api/approvals/:id` `{decision: "approve" | "deny"}` → `Approval`; the turn resumes.

## Memory ("What Bits knows")

- `GET /api/memory` → `MemoryOverview`
- `PUT /api/memory/profile` `{content}` → `{ok:true}`
- `GET /api/memory/log/:month` (e.g. `2026-10`) → `{content}`
- `GET /api/skills/:name` → `{name, description, content}`
- `POST /api/routines/:name/run` → `{turnId}` runs a routine now
- `PATCH /api/routines/:name` `{enabled}` → `{ok:true}`

## Voice

- `GET /api/voice/config` → `VoiceConfig` (`stt`/`tts` = `"browser"` means use the Web Speech API in the client).
- `POST /api/voice/transcribe` multipart form field `audio` (webm/ogg/wav) → `{text}`
- `POST /api/voice/speak` `{text}` → audio bytes (`audio/mpeg`), stream-playable.

## Misc

- `GET /api/health` → `HealthInfo`
