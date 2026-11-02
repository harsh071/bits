// Starts (or reuses) Bits' own Chrome.
//
// It uses its own profile folder, so you sign in to sites once and Bits stays signed in.
// Chrome refuses remote control of your everyday profile, which is also why this is separate:
// Bits never touches your normal browser.
//
// Chrome is started detached, so it keeps running when the daemon restarts. On the next start
// we read the port Chrome wrote to <profile>/DevToolsActivePort and reconnect.

import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { browserEndpoint } from "./cdp.ts";

export const CHROME_PATHS = [
  process.env.BITS_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((p): p is string => !!p);

export function findChrome(paths = CHROME_PATHS): string | null {
  for (const p of paths) {
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

export interface ChromeOptions {
  profileDir: string;
  headless?: boolean;
  chromePath?: string;
  /** First page to open when Chrome is started fresh. */
  startUrl?: string;
  windowSize?: [number, number];
}

export function chromeArgs(o: ChromeOptions): string[] {
  const [w, h] = o.windowSize ?? [1280, 860];
  return [
    "--remote-debugging-port=0", // Chrome picks a free port and writes it to DevToolsActivePort
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${o.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${w},${h}`,
    ...(o.headless ? ["--headless=new"] : []),
    o.startUrl ?? "about:blank",
  ];
}

function portFile(profileDir: string) {
  return path.join(profileDir, "DevToolsActivePort");
}

async function liveEndpoint(profileDir: string): Promise<string | null> {
  try {
    const port = Number(readFileSync(portFile(profileDir), "utf8").split("\n")[0]);
    if (!port) return null;
    return await browserEndpoint(port, 700);
  } catch {
    return null;
  }
}

/** Returns the browser WebSocket URL of Bits' Chrome, starting it if needed. */
export async function ensureChrome(o: ChromeOptions): Promise<{ wsUrl: string; started: boolean; kill?: () => void }> {
  mkdirSync(o.profileDir, { recursive: true });
  const existing = await liveEndpoint(o.profileDir);
  if (existing) return { wsUrl: existing, started: false };

  const bin = o.chromePath ?? findChrome();
  if (!bin) throw new Error(`No Chrome found. Install Google Chrome, or set BITS_CHROME to its path. Looked in:\n  ${CHROME_PATHS.join("\n  ")}`);

  rmSync(portFile(o.profileDir), { force: true });
  const child = spawn(bin, chromeArgs(o), { detached: !o.headless, stdio: "ignore" });
  let exited = false;
  child.once("exit", () => (exited = true));
  if (!o.headless) child.unref();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (existsSync(portFile(o.profileDir))) {
      const ws = await liveEndpoint(o.profileDir);
      if (ws) return { wsUrl: ws, started: true, kill: () => child.kill() };
    }
    if (exited && !existsSync(portFile(o.profileDir))) {
      throw new Error(
        "Chrome exited before it could be controlled. If a Chrome window using the Bits profile is already open without remote control, quit it and try again.",
      );
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  child.kill();
  throw new Error("Chrome did not start within 20s");
}
