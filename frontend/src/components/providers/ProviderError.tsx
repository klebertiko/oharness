"use client";

import { Notice } from "@/components/ui";
import { useT } from "@/i18n/store";
import { providerErrorText, type ProviderErrorCode } from "./errorCatalog";

/** What happened, why, and what to do, for one catalog row. Only catalog text: nothing the provider sent. */
export function ProviderErrorLines({ code }: { code: ProviderErrorCode }) {
  const t = useT();
  const keys = providerErrorText(code);
  return (
    <div data-provider-error={code}>
      <p className="font-medium text-ink">{t(keys.what)}</p>
      <p>{t(keys.why)}</p>
      <p>{t(keys.action)}</p>
    </div>
  );
}

/** The same row as a notice of its own, for a screen that has no failure box to put it in. */
export function ProviderErrorNotice({ code, className }: { code: ProviderErrorCode; className?: string }) {
  const t = useT();
  const keys = providerErrorText(code);
  return (
    <Notice tone="fault" title={t(keys.what)} className={className}>
      <div data-provider-error={code}>
        <p>{t(keys.why)}</p>
        <p>{t(keys.action)}</p>
      </div>
    </Notice>
  );
}
