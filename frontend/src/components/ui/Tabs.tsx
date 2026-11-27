"use client";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

/** A tab set: one tab stop, arrows move, the panel is labelled by the chosen tab. */
export function Tabs({
  label,
  value,
  onChange,
  tabs,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  tabs: TabItem[];
  className?: string;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onChange} className={cn("flex min-w-0 flex-col gap-(--gap-2)", className)}>
      <TabsPrimitive.List aria-label={label} className="inline-flex gap-(--gap-1) border-b border-border-1">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className={cn(
              "h-control-md rounded-t-sm px-(--pad-3) t-ui font-medium text-fg-3 transition-colors",
              "pointer-coarse:h-control-touch data-[state=active]:border-b-2 data-[state=active]:border-signal data-[state=active]:text-fg-1",
              "disabled:cursor-not-allowed disabled:opacity-45",
            )}
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content key={tab.value} value={tab.value} className="t-body text-fg-2">
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
