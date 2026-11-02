// Read the action log:  pnpm --filter @bits/computer log [YYYY-MM-DD | --days | --json]
import os from "node:os";
import path from "node:path";
import { ActionLog, formatTimeline } from "./log.ts";

const log = new ActionLog(path.join(process.env.BITS_HOME ?? path.join(os.homedir(), ".bits"), "actions"));
const args = process.argv.slice(2);
if (args.includes("--days")) console.log(log.days().join("\n") || "(no log yet)");
else {
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const entries = log.read(date);
  if (args.includes("--json")) for (const e of entries) console.log(JSON.stringify(e));
  else console.log(formatTimeline(entries) || `(nothing logged ${date ?? "today"}; log folder: ${log.dir})`);
}
