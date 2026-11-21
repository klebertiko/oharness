"use client";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** A switch: the choice takes effect immediately. The label is the accessible name. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { label, checked, onCheckedChange, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-control-sm w-[calc(var(--control-sm)*1.8)] flex-none items-center rounded-full border border-border-2 bg-bg-hover transition-colors",
        "pointer-coarse:h-control-touch pointer-coarse:w-[calc(var(--control-touch)*1.8)]",
        "disabled:cursor-not-allowed disabled:opacity-45",
        checked && "border-signal bg-signal",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0.5 bottom-0.5 aspect-square rounded-full bg-fg-1",
          checked ? "right-0.5 bg-signal-ink" : "left-0.5",
        )}
      />
    </button>
  );
});
