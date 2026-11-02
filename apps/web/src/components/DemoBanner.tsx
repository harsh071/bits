import { ArrowUpRight } from "lucide-react";

/** Shown at the top of the app in demo builds (VITE_BITS_DEMO=1). */
export function DemoBanner() {
  return (
    <div
      role="status"
      className="flex flex-none items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-accent-soft px-4 py-2 text-center text-[13px] leading-snug text-ink-2 flex-wrap"
    >
      <span>
        <span className="font-semibold text-accent-ink">Demo:</span> running on sample data. Install Bits to run it locally.
      </span>
      <a
        href="/#install"
        className="inline-flex items-center gap-0.5 font-medium text-accent-ink underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        Install
        <ArrowUpRight size={13} aria-hidden />
      </a>
    </div>
  );
}
