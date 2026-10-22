// Bits desktop shell.
// The agent runs in the daemon (always on, even when this app is closed). This shell adds:
//   • a menu-bar/tray presence
//   • a global hotkey (⌥Space by default) that opens a floating quick-ask overlay
//   • native notifications when Bits finishes something or needs your OK while you're elsewhere
//   • starting the daemon if it isn't running yet
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.BITS_PORT ?? 7077);
const DAEMON = `http://127.0.0.1:${PORT}`;
const WEB = process.env.BITS_WEB_URL ?? DAEMON; // dev: Vite on :5173
const HOTKEY = process.env.BITS_HOTKEY ?? "Alt+Space";
const ROOT = path.resolve(import.meta.dirname, "../../..");
const PRELOAD = path.join(import.meta.dirname, "preload.cjs");

let tray = null;
let mainWin = null;
let overlay = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showMain());

// ---------- daemon ----------

async function daemonUp() {
  try {
    const r = await fetch(`${DAEMON}/api/health`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureDaemon() {
  if (await daemonUp()) return;
  const entry = path.join(ROOT, "apps/daemon/src/main.ts");
  const logFile = path.join(app.getPath("logs"), "bits-daemon.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, "a");
  // Detached: the daemon keeps running (routines, background work) after the app quits.
  const child = spawn(process.env.BITS_NODE ?? "node", ["--env-file-if-exists=.env", "--disable-warning=ExperimentalWarning", entry], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  child.unref();
  for (let i = 0; i < 40 && !(await daemonUp()); i++) await new Promise((r) => setTimeout(r, 250));
}

// ---------- windows ----------

function createMain() {
  mainWin = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 380,
    minHeight: 520,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#FBFAF7",
    webPreferences: { preload: PRELOAD, contextIsolation: true },
  });
  mainWin.loadURL(WEB);
  mainWin.once("ready-to-show", () => mainWin.show());
  mainWin.on("close", (e) => {
    // Closing the window keeps Bits alive in the menu bar.
    if (!quitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function showMain() {
  if (!mainWin) createMain();
  mainWin.show();
  mainWin.focus();
  hideOverlay();
}

function createOverlay() {
  overlay = new BrowserWindow({
    width: 680,
    height: 520,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    ...(process.platform === "darwin" ? { type: "panel", vibrancy: undefined } : {}),
    webPreferences: { preload: PRELOAD, contextIsolation: true },
  });
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setAlwaysOnTop(true, "floating");
  overlay.loadURL(`${WEB}/?overlay=1`);
  overlay.on("blur", () => hideOverlay());
}

function toggleOverlay() {
  if (!overlay) createOverlay();
  if (overlay.isVisible()) return hideOverlay();
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [w] = overlay.getSize();
  overlay.setPosition(Math.round(workArea.x + (workArea.width - w) / 2), Math.round(workArea.y + workArea.height * 0.18));
  overlay.show();
  overlay.focus();
  overlay.webContents.send("bits:overlay-shown");
}

function hideOverlay() {
  if (overlay?.isVisible()) overlay.hide();
}

ipcMain.on("bits:hide-overlay", () => hideOverlay());
ipcMain.on("bits:open-main", () => showMain());
ipcMain.on("bits:resize-overlay", (_e, height) => {
  if (!overlay) return;
  const [w] = overlay.getSize();
  overlay.setSize(w, Math.max(120, Math.min(720, Math.round(height))));
});

// ---------- tray ----------

// A tiny template icon drawn in code: the Bits mascot, a rounded square with "0 0" eyes.
function trayIcon() {
  const size = 36; // @2x for an 18pt menu-bar icon
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const half = 15; // body half-width
  const radius = 9;
  const inBody = (px, py) => {
    const qx = Math.max(Math.abs(px - c) - (half - radius), 0);
    const qy = Math.max(Math.abs(py - c) - (half - radius), 0);
    return qx * qx + qy * qy <= radius * radius;
  };
  // A "0" eye: the outline of a pill, cut out of the body.
  const inZero = (px, py, ex) => {
    const rx = 3.6;
    const ry = 5.6;
    const dx = Math.abs(px - ex);
    const dy = Math.max(Math.abs(py - c) - (ry - rx), 0);
    const d = Math.sqrt(dx * dx + dy * dy);
    return Math.abs(d - rx) <= 1.3;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const on = inBody(px, py) && !inZero(px, py, c - 6) && !inZero(px, py, c + 6);
      const i = (y * size + x) * 4;
      buf[i + 3] = on ? 255 : 0; // BGRA, black with alpha → template image
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("Bits");
  const menu = Menu.buildFromTemplate([
    { label: "Open Bits", click: showMain },
    { label: `Quick ask  (${HOTKEY.replace("Alt", "⌥").replace("Space", "Space")})`, click: toggleOverlay },
    { type: "separator" },
    {
      label: "Open at login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
    },
    { label: "Show Bits' files", click: () => shell.openPath(process.env.BITS_HOME ?? path.join(app.getPath("home"), ".bits")) },
    { type: "separator" },
    { label: "Quit app (Bits keeps running)", click: () => ((quitting = true), app.quit()) },
  ]);
  tray.setContextMenu(menu);
}

// ---------- notifications (Bits reaching out while you're elsewhere) ----------

async function watchEvents() {
  while (true) {
    try {
      const res = await fetch(`${DAEMON}/api/events`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (line) onEvent(JSON.parse(line.slice(5)));
        }
      }
    } catch {
      /* daemon restarting */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function appFocused() {
  return BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.isFocused());
}

async function onEvent(e) {
  if (appFocused() || !Notification.isSupported()) return;
  if (e.type === "approval" && e.approval.status === "pending") {
    const n = new Notification({ title: "Bits needs your OK", body: e.approval.reason, silent: false });
    n.on("click", showMain);
    n.show();
  }
  if (e.type === "turn" && e.status === "done") {
    try {
      const r = await fetch(`${DAEMON}/api/conversations/${e.conversationId}/messages?after=0&limit=5000`);
      const { messages } = await r.json();
      const last = [...messages].reverse().find((m) => m.role === "assistant" && m.turnId === e.turnId);
      const text = last?.parts?.filter((p) => p.type === "text").map((p) => p.text).join(" ").trim();
      if (!text) return;
      const n = new Notification({ title: "Bits", body: text.replace(/[#*_`>]/g, "").slice(0, 180) });
      n.on("click", showMain);
      n.show();
    } catch {
      /* ignore */
    }
  }
}

// ---------- lifecycle ----------

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.setActivationPolicy?.("regular");
  await ensureDaemon();
  buildTray();
  createMain();
  createOverlay();
  if (!globalShortcut.register(HOTKEY, toggleOverlay)) console.warn(`[bits] couldn't register hotkey ${HOTKEY}`);
  watchEvents();
});

app.on("activate", showMain);
app.on("before-quit", () => (quitting = true));
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", (e) => e.preventDefault());
