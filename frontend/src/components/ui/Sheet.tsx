"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

/**
 * A modal float: the command palette, the keyboard map, the harness library.
 * Built on Radix Dialog, so focus is trapped inside, Escape and a click on the
 * scrim close it, and focus returns to whatever opened it (experience.md:
 * sheets trap focus and return it to the opener). Entrance is opacity plus an
 * 8px translate only, instant under `prefers-reduced-motion`.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  placement = "center",
  showClose = false,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the dialog. Always required; `hideTitle` keeps it for assistive tech only. */
  title: string;
  hideTitle?: boolean;
  /** `top` hangs from the title bar like the palette; `center` is a standard sheet. */
  placement?: "top" | "center";
  /** A visible Close button, for sheets a touch user must be able to dismiss without a keyboard. */
  showClose?: boolean;
  className?: string;
  children: ReactNode;
}) {
  /* Radix returns focus only to a Dialog.Trigger. These sheets are opened from
     store state, so remember what had focus as the sheet takes it and hand it
     back on close. */
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="oh-sheet-scrim fixed inset-0 z-50 bg-[var(--overlay-backdrop)]" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            const el = opener.current;
            opener.current = null;
            if (el && el !== document.body && el.isConnected) {
              e.preventDefault();
              el.focus();
            }
          }}
          className={cn(
            "oh-sheet fixed left-1/2 z-50 flex max-h-[calc(100dvh-var(--h-titlebar)-20px)] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden",
            "rounded-float border border-line bg-sub-100 shadow-[var(--shadow-float)]",
            placement === "top" ? "top-[calc(var(--h-titlebar)+10px)]" : "top-1/2 -translate-y-1/2",
            className,
          )}
        >
          <Dialog.Title className={hideTitle ? "sr-only" : "t-title flex-none border-b border-line-soft px-3 py-2 text-ink"}>{title}</Dialog.Title>
          {showClose && (
            <Dialog.Close asChild>
              <Button iconOnly size="sm" variant="ghost" aria-label="Close" className="absolute right-1 top-1 z-10" icon={<X size={14} aria-hidden />} />
            </Dialog.Close>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
