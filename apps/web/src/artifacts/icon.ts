import { BookOpen, ClipboardList, FileText, LayoutDashboard, ListChecks, Map, Sparkles, Target, type LucideIcon } from "lucide-react";
import { iconFor } from "../genui/icons";

const BY_KIND: Record<string, LucideIcon> = {
  tracker: Target,
  habit: Target,
  planner: Map,
  plan: Map,
  trip: Map,
  list: ListChecks,
  checklist: ListChecks,
  dashboard: LayoutDashboard,
  form: ClipboardList,
  notes: FileText,
  reading: BookOpen,
};

export function artifactIcon(a: { icon?: string; kind?: string }): LucideIcon {
  if (a.icon) {
    const I = iconFor(a.icon, false);
    if (I) return I;
  }
  const k = (a.kind ?? "").toLowerCase();
  return BY_KIND[k] ?? Object.entries(BY_KIND).find(([key]) => k.includes(key))?.[1] ?? Sparkles;
}
