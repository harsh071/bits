// Try Bits Computer by hand:  pnpm --filter @bits/computer try [url]
//
// Opens Bits' Chrome (profile in ~/.bits/chrome, or $BITS_HOME/chrome) and gives you a prompt:
//   open <url> | snap [all] | text | click <ref> | type <ref> <text> | enter <ref> <text>
//   press <key> | select <ref> <value> | scroll up|down | back | dialog accept|dismiss | tabs | tab <n> | quit
// Writes your actions cause (POST/PUT/PATCH/DELETE) are held and you answer y/n.

import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { Computer, type Step } from "./index.ts";

const home = process.env.BITS_HOME ?? path.join(os.homedir(), ".bits");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let asking = Promise.resolve();

const c = await Computer.start({
  profileDir: path.join(home, "chrome"),
  headless: process.argv.includes("--headless"),
  onWrite: (w) => {
    const answer = asking.then(() => rl.question(`\n  ⏸  ${w.method} ${w.url}\n     allow? [y/N] `));
    asking = answer.then(() => {});
    return answer.then((a) => (/^y/i.test(a.trim()) ? "allow" : "deny"));
  },
});

const url = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (url) print(await c.open(url));
else print(await c.snapshot());

function print(s: { text: string; ms: number }) {
  console.log(`\n${s.text}\n  (${s.ms} ms)`);
}

function parse(line: string): Step | null {
  const [cmd, a, ...rest] = line.split(" ");
  const n = Number(a);
  switch (cmd) {
    case "click": return { click: n };
    case "type": return { type: n, text: rest.join(" ") };
    case "enter": return { type: n, text: rest.join(" "), submit: true };
    case "press": return { press: a ?? "Enter" };
    case "select": return { select: n, value: rest.join(" ") };
    case "hover": return { hover: n };
    case "scroll": return { scroll: a === "up" ? "up" : Number.isFinite(n) ? n : "down" };
    case "back": return { back: true };
    case "dialog": return { dialog: a === "accept" ? "accept" : "dismiss" };
    case "wait": return { wait: n };
  }
  return null;
}

for (;;) {
  const line = (await rl.question("\nbits> ")).trim();
  if (!line) continue;
  if (line === "quit" || line === "q") break;
  try {
    if (line.startsWith("open ")) print(await c.open(line.slice(5).trim()));
    else if (line === "snap" || line === "snap all") print(await c.snapshot({ all: line.endsWith("all") }));
    else if (line === "text") console.log(await c.text());
    else if (line === "tabs") console.table(await c.tabs());
    else if (line.startsWith("tab ")) print(await c.useTab(Number(line.slice(4))));
    else {
      // Several steps in one go: separate with ";", e.g.  type 4 hello; click 7
      const steps = line.split(";").map((s) => parse(s.trim()));
      if (steps.some((s) => !s)) {
        console.log("?  open <url> | snap [all] | text | click N | type N text | enter N text | press Key | select N value | scroll up|down|N | back | dialog accept|dismiss | tabs | tab N | quit");
        continue;
      }
      const r = await c.act(steps as Step[]);
      if (r.observed.length) console.log(`\n  observed: ${r.observed.join(" · ")}`);
      if (r.error) console.log(`  ✖ ${r.error}`);
      console.log(`\n${r.snapshot.text}\n  (${r.done} step(s) + settle + snapshot: ${r.ms} ms)`);
    }
  } catch (e) {
    console.log(`  ✖ ${e instanceof Error ? e.message : e}`);
  }
}
c.close();
rl.close();
