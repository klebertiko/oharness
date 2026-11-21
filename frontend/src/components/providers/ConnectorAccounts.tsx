"use client";

import { Button } from "@/components/ui";
import { useT } from "@/i18n/store";

export type ConnectorAccount = { id: string; label: string; signedIn: boolean };

/** Sign in or cancel a connector. A credential value is never rendered, even if one is passed. */
export function ConnectorAccounts({
  accounts,
  onSignIn,
  onCancel,
}: {
  accounts: ConnectorAccount[];
  onSignIn: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const t = useT();
  return (
    <ul aria-label={t("providers.connectors.title")} className="space-y-2">
      {accounts.map((account) => (
        <li key={account.id} className="flex items-center gap-2">
          <span className="t-body text-ink">{account.label}</span>
          <span className="t-body text-ink-mute">{account.signedIn ? t("providers.connectors.in") : t("providers.connectors.out")}</span>
          {account.signedIn ? (
            <Button size="sm" onClick={() => onCancel(account.id)}>{t("providers.connectors.cancel")}</Button>
          ) : (
            <Button size="sm" onClick={() => onSignIn(account.id)}>{t("providers.connectors.enter")}</Button>
          )}
        </li>
      ))}
    </ul>
  );
}
