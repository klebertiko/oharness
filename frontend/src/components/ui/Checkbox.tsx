"use client";
import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  hint?: string;
  indeterminate?: boolean;
}

/** A labelled checkbox. Mixed is for a parent whose children disagree. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, indeterminate = false, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <label htmlFor={fieldId} className={cn("inline-flex min-h-control-md items-center gap-(--gap-2) pointer-coarse:min-h-control-touch", className)}>
      <span className="relative inline-flex size-(--icon) flex-none">
        <input
          ref={(node) => {
            if (node) node.indeterminate = indeterminate;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          id={fieldId}
          type="checkbox"
          aria-checked={indeterminate ? "mixed" : undefined}
          aria-describedby={hintId}
          className="peer size-(--icon) appearance-none rounded-xs border border-border-2 bg-bg-pane checked:border-signal checked:bg-signal indeterminate:border-signal indeterminate:bg-signal disabled:cursor-not-allowed disabled:opacity-45"
          {...rest}
        />
        {indeterminate ? (
          <Minus aria-hidden className="pointer-events-none absolute inset-0 m-auto size-(--icon) text-signal-ink" />
        ) : (
          <Check aria-hidden className="pointer-events-none absolute inset-0 m-auto size-(--icon) text-signal-ink opacity-0 peer-checked:opacity-100" />
        )}
      </span>
      <span className="t-ui text-fg-1">
        {label}
        {hint && (
          <span id={hintId} className="mt-0.5 block t-meta text-fg-3">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
});
