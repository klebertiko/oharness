"use client";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { portalHost } from "./portalHost";

/** A name for an icon control. The trigger must be able to hold a ref. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [host, setHost] = useState<HTMLElement | undefined>(undefined);
  // Resolved once the trigger is in the page: changing the container while open would remount the content.
  useEffect(() => setHost(portalHost(triggerRef.current)), []);
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger ref={triggerRef} asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal container={host}>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-50 rounded-sm bg-fg-1 px-(--pad-2) py-(--pad-1) t-caption text-bg-app"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
