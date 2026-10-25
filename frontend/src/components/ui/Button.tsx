"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one main action in a view; secondary = default; ghost = toolbars; danger = destructive. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Keeps the button's width, hides the label, shows a spinner, ignores clicks. */
  loading?: boolean;
  /** Leading icon; inherits currentColor. */
  icon?: ReactNode;
  /** Square button with an icon and no label. Requires `aria-label`. */
  iconOnly?: boolean;
}

/* Heights are control-sm/md/lg; narrow layouts raise every size to the 36px
   touch target (experience.md, Targets). */
const SIZE: Record<ButtonSize, string> = {
  sm: "h-control-sm px-2 text-body max-sm:h-control-lg",
  md: "h-control-md px-3 text-title max-sm:h-control-lg",
  lg: "h-control-lg px-4 text-title",
};
const SQUARE: Record<ButtonSize, string> = {
  sm: "w-control-sm px-0 max-sm:w-control-lg",
  md: "w-control-md px-0 max-sm:w-control-lg",
  lg: "w-control-lg px-0",
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-signal text-signal-ink hover:bg-[color-mix(in_oklab,var(--signal)_88%,var(--ink-primary))] active:bg-signal-deep",
  secondary: "border-line-strong bg-sub-200 text-ink hover:bg-sub-300 active:bg-sub-400",
  ghost: "text-ink-dim hover:bg-sub-200 hover:text-ink active:bg-sub-300",
  danger: "border-fault bg-transparent text-fault-text hover:bg-[color-mix(in_oklab,var(--fault)_14%,transparent)]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, iconOnly = false, className, children, disabled, onClick, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={cn(
        "relative inline-flex flex-none select-none items-center justify-center gap-2 whitespace-nowrap rounded-control border border-transparent font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-45 aria-[busy=true]:cursor-progress",
        SIZE[size],
        iconOnly && SQUARE[size],
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {/* The label stays in layout while loading so the width never changes. */}
      <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
        {icon}
        {children}
      </span>
      {loading && (
        <span
          role="status"
          aria-label="Working"
          className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
        />
      )}
    </button>
  );
});
