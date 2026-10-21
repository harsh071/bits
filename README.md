# Bits

**An open-source, local-first personal agent that stays awake for you.**
Inspired by Meta's Muse, OpenAI's Dots and Grok Bot, but it runs on your own machine.
A small always-on daemon does the work and remembers everything in plain files. A calm app, a ⌥Space quick-ask overlay and a voice mode all show the same conversation.

- **Always on.** The daemon runs as a background service. Routines wake it on a schedule, and work continues when the app is closed.
- **Crash-safe turns.** Every step of a turn is saved before the next one. After a crash, the turn picks up where it stopped, and finished tools never run twice.
- **Steer, don't babysit.** Message it mid-task. Risky actions go through the *Sentinel*, an independent reviewer that only trusts your own words, and ask you only when needed.
- **Memory in files.** `~/.bits/memory/profile.md`, a dated fact log, `skills/*/SKILL.md` and `routines/*.md`, all Markdown you can read and edit. Searched with SQLite FTS5.
- **Intelligent UI.** The agent answers with cards, tables, charts, timelines, checklists and tappable actions from a safe component catalog.
- **Voice.** Talk to it hands-free with barge-in. Uses the browser, OpenAI or Cartesia today, with local models planned.
- **Any model.** Anthropic, OpenAI, or local models through Ollama / LM Studio (via AI SDK 7). Connect apps with MCP.

## Quick start

```bash
cp .env.example .env          # add ANTHROPIC_API_KEY (or OPENAI_API_KEY, or set BITS_MODEL=local:<model>)
pnpm install
pnpm dev                      # daemon on :7077, web app on :5173
pnpm dev:desktop              # optional: tray icon + ⌥Space overlay
pnpm service:install          # optional: keep the daemon running at login (launchd / systemd)
```

Requires Node 24+ (24.16+ recommended; uses the built-in SQLite) and pnpm. Data lives in `~/.bits` (override with `BITS_HOME`).

## Layout

| Path | What |
| --- | --- |
| `packages/protocol` | Shared types: messages, live events, the generative UI catalog |
| `apps/daemon` | The agent: queue, durable loop, Sentinel, memory, routines, connectors, voice, HTTP/SSE API |
| `apps/web` | React app: chat, generative UI renderer, memory view, voice mode, quick-ask overlay |
| `apps/desktop` | Electron shell: tray, global hotkey overlay, notifications, starts the daemon |
| `docs/api.md` | The daemon's REST + SSE contract |
| `docs/ARCHITECTURE.md` | How it works and why |

## Connect apps (MCP)

Edit `~/.bits/connectors.json` and restart the daemon:

```json
{ "servers": {
  "github": { "url": "https://api.githubcopilot.com/mcp/", "headers": { "Authorization": "Bearer <token>" } },
  "files":  { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Documents"] }
} }
```

Tools marked read-only run freely, destructive ones always ask, and everything else is auto-reviewed. Add `"allow"`, `"ask"` or `"deny"` patterns (e.g. `"mcp__github__*"`) to `~/.bits/policy.json`.

## Tests

```bash
pnpm --filter @bits/daemon test
```

## License

MIT
