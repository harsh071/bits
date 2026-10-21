# Architecture

Bits has three parts: **apps & channels** (thin views), the **daemon** (runs the agent, always on), and the **agent's computer** (where tools act).

## Rules the design follows
1. **Thin client, thick server.** Apps only display. The daemon owns conversations, turns and memory.
2. **When nothing happens, nothing runs; everything that matters is saved.** Messages and routines wake turns. Each step is written to SQLite before the next.
3. **Notifications only say "something changed."** SSE events carry `{conversationId, seq}`. Apps fetch `?after=lastSeq`, merge by seq and dedupe by id. Token deltas are ephemeral extras.
4. **What the agent knows lives in files.** `~/.bits/memory`, `skills`, `routines`. SQLite FTS is a derived index.
5. **Try the cheapest option first.** Memory → connectors (MCP) → web → own computer → ask you. Report broken connectors; don't work around them.
6. **Steering, not approving.** Mid-turn messages steer the running turn. The Sentinel auto-reviews risky calls.

## A turn (`apps/daemon/src/agent/runtime.ts`)
- One worker per conversation. Turns are `queued → running → (waiting) → done | failed | cancelled`.
- Loop: finish pending tool calls → model step (streamed) → save the assistant message → repeat until there are no tool calls and no new steering messages.
- **Durability:** the transcript is the journal. A running turn holds a 30s lease that is renewed while it works. On restart, expired leases are reclaimed and the loop continues from the last saved message. `tool_runs` stores results by tool-call id, so a tool never runs twice.
- **Approvals:** the Sentinel returns run / ask / deny. "Ask" writes a placeholder result `{status:"needs_approval"}` and parks the turn as `waiting`. The decision re-queues it, and the latest result for a call wins.
- **Context:** `context.ts` orders the prompt from most to least stable for prompt caching: tools → identity/rules/skills index (cache breakpoint) → profile + recent facts + date → summary → messages (cache breakpoint on the last one). Steering messages that land between a tool call and its result are moved after the result. Unfinished calls get an "interrupted" result.
- **Summarize while away:** 10 minutes after a turn, if the conversation is large, it is summarized with the same prefix (a cache hit). The last three exchanges are kept verbatim and durable facts are flushed to the log first. This is skipped when a routine is about to run. Turns over 150k tokens also compact mid-turn.
- **Helpers:** `spawn_helper` runs a subagent with a fresh context and non-interactive tools, and returns a report. Several helper calls in one step run in parallel.

## Persistence map
| What | Where |
| --- | --- |
| Conversations, messages (journal), turns, approvals, tool runs, routine timing, FTS | `~/.bits/state.db` (SQLite, WAL) |
| Profile, dated facts | `~/.bits/memory/` |
| Skills | `~/.bits/skills/<name>/SKILL.md` |
| Routines | `~/.bits/routines/<name>.md` (frontmatter `schedule`, `enabled`) |
| Connectors, policy | `~/.bits/connectors.json`, `~/.bits/policy.json` |
| Agent's files / shell cwd | `~/.bits/workspace/` |

## Scaling path
A single SQLite file serves one person well. For a hosted multi-device install, swap the store for Postgres and run turns on a durable engine (Restate, DBOS or Absurd) behind the same `Runtime` interface. Clients don't change because they speak only `docs/api.md`.
