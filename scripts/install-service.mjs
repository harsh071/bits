#!/usr/bin/env node
// Keep the Bits daemon always on: installs a per-user background service that starts at login
// and restarts if it crashes. macOS → launchd agent; Linux → systemd --user unit.
//   node scripts/install-service.mjs            install + start
//   node scripts/install-service.mjs uninstall  stop + remove
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const node = process.execPath;
const entry = path.join(root, "apps/daemon/src/main.ts");
const args = ["--env-file-if-exists=" + path.join(root, ".env"), "--disable-warning=ExperimentalWarning", entry];
const logs = path.join(os.homedir(), ".bits", "logs");
const uninstall = process.argv[2] === "uninstall";
fs.mkdirSync(logs, { recursive: true });

if (process.platform === "darwin") {
  const label = "dev.bits.daemon";
  const plist = path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);
  try {
    execSync(`launchctl bootout gui/${process.getuid()} ${plist}`, { stdio: "ignore" });
  } catch {}
  if (uninstall) {
    fs.rmSync(plist, { force: true });
    console.log("Bits daemon service removed.");
    process.exit(0);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>${[node, ...args].map((a) => `<string>${a}</string>`).join("")}</array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${logs}/daemon.log</string>
  <key>StandardErrorPath</key><string>${logs}/daemon.log</string>
</dict></plist>
`;
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, xml);
  execSync(`launchctl bootstrap gui/${process.getuid()} ${plist}`);
  console.log(`Bits daemon installed as ${label}. Logs: ${logs}/daemon.log`);
} else if (process.platform === "linux") {
  const unit = path.join(os.homedir(), ".config/systemd/user/bits.service");
  if (uninstall) {
    try {
      execSync("systemctl --user disable --now bits.service", { stdio: "ignore" });
    } catch {}
    fs.rmSync(unit, { force: true });
    console.log("Bits daemon service removed.");
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(unit), { recursive: true });
  fs.writeFileSync(
    unit,
    `[Unit]\nDescription=Bits personal agent daemon\n\n[Service]\nWorkingDirectory=${root}\nExecStart=${[node, ...args].join(" ")}\nRestart=always\n\n[Install]\nWantedBy=default.target\n`,
  );
  execSync("systemctl --user daemon-reload && systemctl --user enable --now bits.service");
  console.log("Bits daemon installed as a systemd user service.");
} else {
  console.log("Automatic service install supports macOS and Linux. On Windows, run `pnpm start` via Task Scheduler.");
}
