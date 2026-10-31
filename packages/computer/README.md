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

Try it by hand: `pnpm --filter @bits/computer try https://news.ycombinator.com`

The CDP client (`src/cdp.ts`) is adapted from RUI's.

Not yet: elements inside iframes, writes sent by service workers, native Mac apps.
