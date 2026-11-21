"use client";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  hint?: string;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/** A labelled single choice. The list is a listbox; the keyboard is the platform's. */
export function Select({ label, value, onChange, options, hint, error, disabled, placeholder, className }: SelectProps) {
  const auto = useId();
  const msgId = `${auto}-msg`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-(--gap-1)", className)}>
      <label htmlFor={auto} className="t-ui font-medium text-fg-2">
        {label}
      </label>
      <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
        <SelectPrimitive.Trigger
          id={auto}
          aria-invalid={error ? true : undefined}
          aria-describedby={msgId}
          className={cn(
            "inline-flex h-control-md w-full items-center justify-between gap-(--gap-2) rounded-md border border-border-2 bg-bg-pane px-(--pad-2) text-left t-ui text-fg-1",
            "pointer-coarse:h-control-touch max-sm:h-control-lg hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-45",
            "aria-invalid:border-fault",
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder ?? label} />
          <SelectPrimitive.Icon>
            <ChevronDown aria-hidden className="size-(--icon) text-fg-3" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className="z-50 max-h-60 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border-1 bg-bg-elevated shadow-(--shadow-float)"
          >
            <SelectPrimitive.Viewport className="p-(--pad-1)">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="flex cursor-pointer items-center gap-(--gap-2) rounded-xs px-(--pad-2) py-(--pad-1) t-ui text-fg-1 data-[disabled]:opacity-45 data-[highlighted]:bg-bg-hover"
                >
                  <SelectPrimitive.ItemIndicator>
                    <Check aria-hidden className="size-(--icon) text-signal-fg" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      <div id={msgId} role={error ? "alert" : undefined} className={cn("min-h-4 t-meta", error ? "text-fault-fg" : "text-fg-3")}>
        {error ?? hint ?? ""}
      </div>
    </div>
  );
}
