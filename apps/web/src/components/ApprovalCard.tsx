import { useState } from "react";
import { motion } from "motion/react";
import { Check, ShieldAlert, X } from "lucide-react";
import type { ToolCall } from "../lib/blocks";
import { useChat } from "../store/chat";
import { humanize, summarizeInput, toolMeta } from "../lib/tools";

export function ApprovalCard({ call }: { call: ToolCall }) {
  const approvalId = call.approval!.approvalId;
  const known = useChat((s) => s.approvals[approvalId]);
  const pendingIds = useChat((s) => s.pendingApprovalIds);
  const decide = useChat((s) => s.decide);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status: "pending" | "approved" | "denied" | "resolved" =
    known?.status && known.status !== "pending"
      ? known.status
      : call.approval!.resolved
        ? call.result?.isError
          ? "denied"
          : "approved"
        : known?.status === "pending" || pendingIds === null || pendingIds.includes(approvalId)
          ? "pending"
          : "resolved";

  const reason = known?.reason || call.approval!.reason;
  const Icon = toolMeta({ ...call, result: undefined }).icon;
  const summary = summarizeInput(call.name, call.input);

  const act = async (d: "approve" | "deny" | "always") => {
    setBusy(d);
    setError(null);
    try {
      await decide(approvalId, d);
    } catch (e) {
      setError((e as Error).message || "Couldn’t send that. Try again?");
    } finally {
      setBusy(null);
    }
  };

  if (status !== "pending") {
    const ok = status === "approved";
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <span className={`grid h-5 w-5 place-items-center rounded-full ${ok ? "bg-[var(--a-green-soft)] text-[var(--a-green)]" : status === "denied" ? "bg-[var(--a-rose-soft)] text-[var(--a-rose)]" : "bg-surface-2"}`}>
          {ok ? <Check size={12} strokeWidth={2.5} /> : status === "denied" ? <X size={12} strokeWidth={2.5} /> : <Check size={12} />}
        </span>
        {ok ? "Approved" : status === "denied" ? "Denied" : "Decided"} · {humanize(call.name)}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="overflow-hidden rounded-[18px] border border-[color-mix(in_srgb,var(--a-amber)_35%,var(--line))] bg-surface shadow-float"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-[var(--a-amber-soft)] text-[var(--a-amber)]">
          <ShieldAlert size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold tracking-[-0.01em] text-ink">Bits wants your OK</div>
          {reason && <div className="mt-0.5 text-[13.5px] text-ink-2">{reason}</div>}
          <div className="mt-2.5 flex min-w-0 items-center gap-2 rounded-xl border border-line bg-surface-2 px-2.5 py-2 text-[13px]">
            <Icon size={14} className="flex-none text-muted" />
            <span className="flex-none font-medium text-ink">{humanize(call.name)}</span>
            <span className="min-w-0 truncate font-mono text-[12px] text-muted">{summary}</span>
          </div>
          {error && <div className="mt-2 text-[12.5px] text-danger">{error}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/60 px-4 py-2.5">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => act("approve")}
          className="rounded-full bg-ink px-4 py-1.5 text-[13.5px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => act("deny")}
          className="rounded-full border border-line-2 bg-surface px-4 py-1.5 text-[13.5px] font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          {busy === "deny" ? "Denying…" : "Deny"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => act("always")}
          className="ml-auto rounded-full px-2 py-1.5 text-[13px] text-muted transition-colors hover:text-ink disabled:opacity-60"
        >
          {busy === "always" ? "Saving…" : `Always allow ${humanize(call.name).toLowerCase()}`}
        </button>
      </div>
    </motion.div>
  );
}
