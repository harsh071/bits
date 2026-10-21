import { Component, useState, type ReactNode } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";

/** Catches render errors in generated UI and shows a quiet fallback instead of a crash. */
export class GenBoundary extends Component<{ fallback: ReactNode; resetKey?: unknown; children: ReactNode }, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: { key: unknown; error: Error | null }) {
    // A new program (or version) gets a fresh chance to render.
    return props.resetKey !== state.key ? { key: props.resetKey, error: null } : null;
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

export interface Issue {
  code?: string;
  message: string;
  line?: number;
}

/** A subtle, expandable note for parse/validation issues. */
export function IssuesNote({ issues }: { issues: Issue[] }) {
  const [open, setOpen] = useState(false);
  if (!issues.length) return null;
  return (
    <div className="mt-2 text-[12px] text-muted">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 hover:text-ink-2">
        <TriangleAlert size={12} className="text-[var(--a-amber)]" />
        {issues.length === 1 ? "One part couldn’t be drawn" : `${issues.length} parts couldn’t be drawn`}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="mt-1 ml-1 space-y-0.5 border-l border-line pl-3 font-mono text-[11px]">
          {issues.slice(0, 12).map((i, k) => (
            <li key={k}>
              {i.line ? `line ${i.line}: ` : ""}
              {i.code ? `[${i.code}] ` : ""}
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
