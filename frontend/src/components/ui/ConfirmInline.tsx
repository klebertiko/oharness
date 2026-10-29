"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/store";
import { Button } from "./Button";

/**
 * Confirms a destructive action where it was asked, not in a dialog
 * (experience.md: destructive actions are undoable or confirmed; the button
 * names the action and Cancel is the default focus). Escape cancels.
 */
export function ConfirmInline({
  prompt,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
  className,
}: {
  prompt: ReactNode;
  /** Names the action: "Remove key", never "OK". */
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const t = useT();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div
      role="group"
      aria-label={typeof prompt === "string" ? prompt : confirmLabel}
      onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      className={cn("flex flex-wrap items-center gap-2 text-body text-ink-dim", className)}
    >
      <span className="min-w-0 flex-1 basis-48">{prompt}</span>
      <Button ref={cancel} onClick={onCancel} disabled={busy}>
        {t("common.cancel")}
      </Button>
      <Button variant="danger" onClick={onConfirm} loading={busy}>
        {confirmLabel}
      </Button>
    </div>
  );
}
