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
pnpm dev                      # daemon on :7077, web app on :5320
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

Open **Connectors** in the sidebar and pick one:

- **Sign in** (Notion, Linear, Sentry, or any MCP server that supports OAuth): Bits registers itself with the server, you sign in on the provider's own page, and the sign-in comes back to `http://127.0.0.1:7077/oauth/callback` on your machine. This is the standard MCP authorization flow: OAuth 2.1 with PKCE (S256), dynamic client registration, single-use `state`, and tokens refreshed automatically.
- **API key** (GitHub, Composio, or a custom server): paste a key you created with the provider. [Composio](https://composio.dev) is the shortcut to Gmail, Calendar, Slack, Drive and 250+ more apps: make a free account, create an MCP server in its dashboard, then paste the server URL and your API key.

Keys and tokens go into `~/.bits/secrets.enc` (AES-256-GCM), and the encryption key lives in the macOS Keychain or the Linux Secret Service (`~/.bits/secrets.key`, mode 0600, when neither exists; force that with `BITS_SECRETS=file`). The model, the transcript and the HTTP API never see the values; the API only lists key names.

Servers that run on your machine are added by editing `~/.bits/connectors.json` (then restart the daemon). Refer to saved keys as `{{secret:name}}` and to environment variables as `{{env:NAME}}`:

```json
{ "servers": {
  "notion": { "url": "https://mcp.notion.com/mcp", "auth": "oauth" },
  "github": { "url": "https://api.githubcopilot.com/mcp/", "headers": { "Authorization": "Bearer {{secret:github_key}}" } },
  "files":  { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Documents"] }
} }
```

Local servers can't be added through the API, so a web page can never make Bits run a command. The daemon also rejects requests from other sites (`Origin` check) and DNS rebinding (`Host` check); allow extra origins with `BITS_ALLOWED_ORIGINS`.

Tools marked read-only run freely, destructive ones always ask, and everything else is auto-reviewed. Add `"allow"`, `"ask"` or `"deny"` patterns (e.g. `"mcp__github__*"`) to `~/.bits/policy.json`.

## Tests

```bash
pnpm --filter @bits/daemon test
```

## License

MIT
