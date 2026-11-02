// Turns a raw page snapshot into the short text the model reads.

export interface SnapshotItem {
  ref: number;
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  expanded?: boolean;
  selected?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  focused?: boolean;
}

export interface RawSnapshot {
  url: string;
  title: string;
  modal: string | null;
  items: SnapshotItem[];
  above: number;
  below: number;
}

const q = (s: string) => JSON.stringify(s);

export function formatItem(i: SnapshotItem): string {
  if (i.role === "heading") return `  heading ${q(i.name)}`;
  let line = `[${i.ref}] ${i.role} ${q(i.name)}`;
  if (i.value !== undefined) line += ` value=${q(i.value)}`;
  for (const k of ["checked", "expanded", "selected", "pressed"] as const) if (i[k] !== undefined) line += ` ${k}=${i[k]}`;
  if (i.disabled) line += " disabled";
  if (i.focused) line += " focused";
  return line;
}

export function formatSnapshot(s: RawSnapshot, extra: { tab?: string; dialog?: string | null } = {}): string {
  const lines = [`Page: ${s.title || "(untitled)"}`, `URL: ${s.url}`];
  if (extra.tab) lines.push(extra.tab);
  if (extra.dialog) lines.push(`Browser dialog open: ${extra.dialog} — answer it with {"dialog":"accept"} or {"dialog":"dismiss"}.`);
  if (s.modal) lines.push(`Modal open: ${q(s.modal)} (showing only its contents)`);
  if (s.above) lines.push(`… ${s.above} more controls above`);
  for (const i of s.items) lines.push(formatItem(i));
  if (!s.items.length) lines.push("(no controls visible)");
  if (s.below) lines.push(`… ${s.below} more controls below (scroll down, or snapshot with all: true)`);
  return lines.join("\n");
}
