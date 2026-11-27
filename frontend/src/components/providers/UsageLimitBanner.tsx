"use client";

import { useEffect, useId, useRef, useState } from "react";
import { providerReadiness } from "@/components/agent/chatProvider";
import { Button, Notice } from "@/components/ui";
import { useLocaleStore, useT } from "@/i18n/store";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useComposerDraftStore } from "@/store/composerDraftStore";
import { specOf, useProviderStore } from "./providerStore";
import { otherReadyAccounts } from "./view";
import { formatResetLocal, msUntil } from "./usageLimit";

export type LimitAccount = { id: string; label: string };

/** The three ways out of a subscription limit. The held draft is not shown; it lives in `composerDraftStore`. */
export function UsageLimitBanner({
  resetAt,
  draft,
  accounts,
  keyMissing,
  onHoldDraft,
  onUseAccount,
  onUseApiKey,
  onRelease,
  onCancelHold,
}: {
  resetAt: string | null;
  draft: string;
  accounts: LimitAccount[];
  keyMissing?: boolean;
  onHoldDraft: () => void;
  onUseAccount: (id: string) => void;
  onUseApiKey: () => void;
  onRelease: (text: string) => void;
  /** The hold was cancelled: put this text back in the composer. */
  onCancelHold: (text: string) => void;
}) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const time = formatResetLocal(resetAt, locale);
  const held = useComposerDraftStore((s) => s.held);
  const [picking, setPicking] = useState(false);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const noOtherId = useId();

  useEffect(() => {
    if (!held || !resetAt) return;
    const wait = msUntil(resetAt);
    if (wait == null) return;
    const id = window.setTimeout(() => {
      const text = useComposerDraftStore.getState().take();
      if (text) releaseRef.current(text);
    }, wait);
    return () => window.clearTimeout(id);
  }, [held, resetAt]);

  const headline = time ? t("providers.limit.banner", { time }) : t("providers.limit.bannerNoTime");
  // Without a reset instant nothing would ever send a held draft, so it stays in the composer.
  const canHold = msUntil(resetAt) != null;
  const noOther = accounts.length === 0;

  return (
    <Notice tone="warn" role="alert" title={headline}>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={!canHold || !draft.trim() || held != null} onClick={() => {
          const text = draft.trim();
          if (!text || !canHold) return;
          useComposerDraftStore.getState().hold(text);
          onHoldDraft();
        }}>
          {t("providers.limit.hold")}
        </Button>
        <Button size="sm" aria-expanded={noOther ? undefined : picking} disabled={noOther} aria-describedby={noOther ? noOtherId : undefined} onClick={() => setPicking((open) => !open)}>
          {t("providers.limit.other")}
        </Button>
        <Button size="sm" onClick={onUseApiKey}>
          {t("providers.limit.apiKey")}
        </Button>
      </div>
      {held && time && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p role="status">{t("providers.limit.holding", { time })}</p>
          <Button size="sm" variant="ghost" onClick={() => {
            const text = useComposerDraftStore.getState().take();
            if (text) onCancelHold(text);
          }}>
            {t("providers.limit.cancelHold")}
          </Button>
        </div>
      )}
      {noOther && <p id={noOtherId} className="mt-2">{t("providers.limit.noOther")}</p>}
      {picking && !noOther && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("providers.limit.other")}>
          {accounts.map((account) => (
            <li key={account.id}>
              <Button size="sm" onClick={() => onUseAccount(account.id)}>{account.label}</Button>
            </li>
          ))}
        </ul>
      )}
      {keyMissing && <p className="mt-2">{t("providers.limit.noKey")}</p>}
    </Notice>
  );
}

/** Composer mount. Reads the limit a run recorded. Renders nothing when there is none. */
export function ComposerUsageLimit({
  draft,
  onHoldDraft,
  onRelease,
  onCancelHold,
}: {
  draft: string;
  onHoldDraft: () => void;
  onRelease: (text: string) => void;
  onCancelHold: (text: string) => void;
}) {
  const limit = useProviderStore((s) => s.usageLimit);
  const connections = useProviderStore((s) => s.connections);
  const setChosen = useChatProviderStore((s) => s.setChosen);
  const [keyMissing, setKeyMissing] = useState(false);
  if (!limit) return null;
  return (
    <div className="px-3 pb-2">
      <UsageLimitBanner
        resetAt={limit.resetAt}
        draft={draft}
        accounts={otherReadyAccounts(connections, limit.connectionId).map((c) => ({ id: c.id, label: c.label }))}
        keyMissing={keyMissing}
        onHoldDraft={onHoldDraft}
        onUseAccount={(id) => setChosen(id)}
        onUseApiKey={() => {
          const key = connections.find((c) => c.id !== limit.connectionId && specOf(c).credential.kind === "api-key" && providerReadiness(c).ready);
          if (key) {
            setKeyMissing(false);
            setChosen(key.id);
          } else setKeyMissing(true);
        }}
        onRelease={onRelease}
        onCancelHold={onCancelHold}
      />
    </div>
  );
}
