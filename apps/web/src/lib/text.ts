/** Strip markdown into speakable plain text. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Pull complete sentences off the front of `text`. Returns the sentences and how many characters
 * were consumed. With `final`, the remainder counts as a sentence too.
 */
export function takeSentences(text: string, final = false): { sentences: string[]; consumed: number } {
  const sentences: string[] = [];
  let consumed = 0;
  const re = /[^.!?\n]*(?:[.!?]+["')\]]*(?=\s|$)|\n)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    const end = m.index + m[0].length;
    // Need a following char to be sure the sentence really ended (unless newline or final).
    if (!final && end >= text.length && !m[0].endsWith("\n")) break;
    const s = m[0].trim();
    if (s) sentences.push(s);
    consumed = end;
  }
  if (final && consumed < text.length) {
    const rest = text.slice(consumed).trim();
    if (rest) sentences.push(rest);
    consumed = text.length;
  }
  // Merge very short fragments ("Sure." "Ok.") into the next sentence for smoother speech.
  const merged: string[] = [];
  for (const s of sentences) {
    const prev = merged[merged.length - 1];
    if (prev && prev.length < 18) merged[merged.length - 1] = `${prev} ${s}`;
    else merged.push(s);
  }
  return { sentences: merged, consumed };
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

export function relTime(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "—";
  const diff = ts - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [u, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), u);
  return diff >= 0 ? "in a moment" : "just now";
}

export function shortTime(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmtTime = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: m ? "2-digit" : undefined });
};

/** Best-effort human description of a 5-field cron expression. Falls back to the raw string. */
export function humanCron(expr: string): string {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = f;
  const num = (s: string) => /^\d+$/.test(s);
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `Every ${min.slice(2)} minutes`;
  if (num(min) && hour === "*" && dom === "*" && dow === "*") return `Every hour at :${min.padStart(2, "0")}`;
  if (num(min) && hour.startsWith("*/") && dom === "*" && dow === "*") return `Every ${hour.slice(2)} hours`;
  if (!num(min) || !(num(hour) || /^\d+(,\d+)+$/.test(hour)) || mon !== "*") return expr;
  const times = hour
    .split(",")
    .map((h) => fmtTime(+h, +min))
    .join(" & ");
  let days = "";
  if (dom === "*" && dow === "*") days = "Every day";
  else if (dom === "*" && (dow === "1-5" || dow === "MON-FRI")) days = "Weekdays";
  else if (dom === "*" && (dow === "0,6" || dow === "6,0" || dow === "SAT,SUN")) days = "Weekends";
  else if (dom === "*" && /^[0-7](,[0-7])*$/.test(dow))
    days = dow
      .split(",")
      .map((d) => DOW[+d % 7].slice(0, 3))
      .join(", ");
  else if (dom === "*" && /^[0-7]-[0-7]$/.test(dow)) {
    const [a, b] = dow.split("-").map((d) => DOW[+d % 7].slice(0, 3));
    days = `${a}–${b}`;
  } else if (num(dom) && dow === "*") days = `Monthly on the ${dom}${ordinal(+dom)}`;
  else return expr;
  return `${days} at ${times}`;
}
const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
