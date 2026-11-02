// Copies the demo build (apps/web/dist-demo, built with VITE_BITS_DEMO=1 and base /demo/) into dist/demo.
import { cpSync, existsSync, rmSync } from "node:fs";

const from = new URL("../../web/dist-demo/", import.meta.url);
const to = new URL("../dist/demo/", import.meta.url);
if (!existsSync(from)) throw new Error("apps/web/dist-demo is missing: run `pnpm --filter @bits/web build:demo` first");
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("Copied the demo into dist/demo");
