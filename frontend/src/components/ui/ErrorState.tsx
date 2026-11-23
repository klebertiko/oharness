"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/store";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

/** How long "Copied" stays before the button reads "Copy diagnostic" again. */
const COPIED_HOLD = 2000;

/**
 * What failed, why, and what to do. The three actions are try again, open the
 * detail, and copy the diagnostic.
 */
export function ErrorState({
  title,
  reason,
  diagnostic,
  onRetry,
  onDetails,
  className,
}: {
  /** What failed. */
  title: string;
  /** Why it failed, in one sentence. */
  reason: string;
  /** Text copied by "Copy diagnostic". */
  diagnostic: string;
  onRetry?: () => void;
  onDetails?: () => void;
  className?: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  const [details, setDetails] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnostic);
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_HOLD);
    } catch {
      setDetails(true);
    }
  };
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-(--gap-2) rounded-md border border-fault-border bg-fault-bg px-(--pad-4) py-(--pad-3)", className)}>
      <p className="t-ui font-medium text-fault-fg">{title}</p>
      <p className="t-body text-fg-2">{reason}</p>
      <div className="flex flex-wrap gap-(--gap-2)">
        {onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {t("ui.retry")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDetails((open) => !open);
            onDetails?.();
          }}
        >
          {t("ui.openDetails")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void copy()}>
          {copied ? t("ui.copied") : t("ui.copyDiagnostic")}
        </Button>
      </div>
      {details && (
        <pre className="w-full overflow-x-auto rounded-xs bg-bg-pane p-(--pad-2) t-code text-fg-2">{diagnostic}</pre>
      )}
    </div>
  );
}
