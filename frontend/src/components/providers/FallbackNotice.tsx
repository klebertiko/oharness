"use client";

import { useEffect } from "react";
import { Button, Notice } from "@/components/ui";
import { useT } from "@/i18n/store";
import { useChatFallbackStore } from "@/store/chatFallbackStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useProviderStore } from "./providerStore";

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

/** The chat's notice, driven by the run's failover signal (`useRunStream`). Labels are the person's own
    account names; the reason is one of the closed classes, worded here. */
export function ChatFallbackNotice({ className }: { className?: string }) {
  const t = useT();
  const notice = useChatFallbackStore((s) => s.notice);
  const back = useChatFallbackStore((s) => s.back);
  const dismiss = useChatFallbackStore((s) => s.dismiss);
  const chosenId = useChatProviderStore((s) => s.chosenId);
  const connections = useProviderStore((s) => s.connections);
  // The person picked another account themselves: the notice no longer describes the chat.
  useEffect(() => {
    if (notice && chosenId !== notice.toId) dismiss();
  }, [notice, chosenId, dismiss]);
  if (!notice || chosenId !== notice.toId) return null;
  const label = (id: string) => connections.find((c) => c.id === id)?.label ?? id;
  return (
    <div className={className}>
      <FallbackNotice
        from={label(notice.fromId)}
        to={label(notice.toId)}
        reason={t(`providers.fallback.reason.${notice.reason}`)}
        onReturn={back}
      />
    </div>
  );
}
