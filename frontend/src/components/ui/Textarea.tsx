"use client";
import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}

/** A labelled multi-line field. The message row reserves its line, as Input does. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, mono = false, className, id, rows = 4, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  const msgId = `${fieldId}-msg`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-(--gap-1)", className)}>
      {label && (
        <label htmlFor={fieldId} className="t-ui font-medium text-fg-2">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={msgId}
        className={cn(
          "min-h-control-lg w-full resize-y rounded-md border border-border-2 bg-bg-pane px-(--pad-2) py-(--pad-2) text-fg-1 transition-colors",
          "placeholder:text-fg-3 hover:bg-bg-hover focus-visible:border-signal disabled:cursor-not-allowed disabled:opacity-45",
          "pointer-coarse:min-h-control-touch aria-invalid:border-fault",
          mono ? "t-code" : "t-body",
        )}
        {...rest}
      />
      <div id={msgId} role={error ? "alert" : undefined} className={cn("min-h-4 t-meta", error ? "text-fault-fg" : "text-fg-3")}>
        {error ?? hint ?? ""}
      </div>
    </div>
  );
});
