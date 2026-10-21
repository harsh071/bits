import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "solid" | "soft";
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, children, size = "md", variant = "ghost", className = "", ...rest },
  ref,
) {
  const dim = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  const look =
    variant === "solid"
      ? "bg-ink text-bg hover:opacity-90 disabled:bg-line-2 disabled:text-faint"
      : variant === "soft"
        ? "bg-accent-soft text-accent-ink hover:bg-accent-soft-2"
        : "text-muted hover:bg-surface-2 hover:text-ink";
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={`grid flex-none place-items-center rounded-full transition-all duration-150 active:scale-95 ${dim} ${look} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
