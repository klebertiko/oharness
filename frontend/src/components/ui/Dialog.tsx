"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { useT } from "@/i18n/store";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

/**
 * A modal dialog. Focus is trapped, Escape closes it, and focus returns to
 * the trigger. The title is required.
 */
export function Dialog({
  title,
  description,
  trigger,
  children,
  open,
  onOpenChange,
}: {
  title: string;
  description?: string;
  trigger?: ReactNode;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="oh-sheet-scrim fixed inset-0 z-50 bg-(--overlay-backdrop)" />
        <DialogPrimitive.Content
          className={cn(
            "oh-sheet fixed top-1/2 left-1/2 z-50 w-[min(var(--sheet-max),calc(100vw-var(--sheet-inset)))] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-border-1 bg-bg-elevated p-(--pad-4) shadow-(--shadow-float)",
          )}
        >
          <DialogPrimitive.Title className="t-title text-fg-1">{title}</DialogPrimitive.Title>
          {description && <DialogPrimitive.Description className="mt-(--pad-2) t-body text-fg-2">{description}</DialogPrimitive.Description>}
          <div className="mt-(--pad-3)">{children}</div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="sm" className="mt-(--pad-3)">
              {t("ui.close")}
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
