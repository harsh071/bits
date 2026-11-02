# @bits/computer

Fast browser control for Bits. It drives Bits' own Chrome over the Chrome DevTools Protocol (CDP).

- **Reads the page, not pixels.** One script in an isolated world (it shares the page's DOM, never its JavaScript) returns a short list of controls: `[12] button "Send"`. About 2–6 ms on real sites, 2–5 KB of text.
- **Many steps per call.** `act([{ type: 4, text: "milk" }, { click: 7 }])` runs both, waits until the page stops changing, and returns one fresh snapshot plus what it saw (navigations, new tabs, dialogs, writes).
- **Only writes wait.** Clicks and typing run right away. A POST/PUT/PATCH/DELETE caused by Bits' actions is held and passed to `onWrite`; deny it and it never leaves the browser.
- **Its own Chrome profile** (`~/.bits/chrome`). Sign in to sites once. Your everyday Chrome is never touched.

```ts
const c = await Computer.start({ profileDir, onWrite: async (w) => "allow", onPointer: (p) => {} });
const page = await c.open("news.ycombinator.com");
const r = await c.act([{ click: 12 }]);
```

## Action log

Every step Bits takes, and everything that step caused, goes to `~/.bits/actions/YYYY-MM-DD.jsonl` (pass `onLog`; see `src/log.ts`). Each sent or blocked request points at the click that caused it.

```
17:57:51  "try logging in"  ·  news.ycombinator.com/login  ·  2 step(s)
  ✓ 1. type textbox "" ← "demo"  8ms
  ✓ 2. press  = "Enter"  13ms
       ⛔ blocked POST news.ycombinator.com/login by sentinel: the user only asked to read
```

Read it with `pnpm --filter @bits/computer log` (`--json`, a date, or `--days`). Only Bits' own actions are logged, never your browsing. Request bodies aren't stored (only their size), URLs drop query strings, and password fields log as `•••`.

Try it by hand: `pnpm --filter @bits/computer try https://news.ycombinator.com`

The CDP client (`src/cdp.ts`) is adapted from RUI's.

Not yet: elements inside iframes, writes sent by service workers, native Mac apps.
