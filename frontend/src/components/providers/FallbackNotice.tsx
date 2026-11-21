"use client";

import { Button, Notice } from "@/components/ui";
import { useT } from "@/i18n/store";

/** The engine answered with another account. The in-progress turn is not rewritten. */
export function FallbackNotice({
  from,
  to,
  reason,
  onReturn,
}: {
  from: string;
  to: string;
  reason: string;
  onReturn: () => void;
}) {
  const t = useT();
  return (
    <Notice tone="info" role="status">
      <p>{t("providers.fallback.line", { from, to, reason })}</p>
      <Button size="sm" onClick={onReturn}>{t("providers.fallback.back", { from })}</Button>
    </Notice>
  );
}
