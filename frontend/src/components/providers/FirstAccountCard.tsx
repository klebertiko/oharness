"use client";

import { Button } from "@/components/ui";
import { useT } from "@/i18n/store";
import { providerReadiness } from "@/components/agent/chatProvider";
import { specOf, type Connection } from "./providerStore";

export function hasReadyAccount(connections: Connection[]): boolean {
  return connections.some((c) => providerReadiness(c).ready);
}

/** One card until the first account can answer. Then it goes away. */
export function FirstAccountCard({
  connections,
  onChoose,
}: {
  connections: Connection[];
  onChoose: (id: string) => void;
}) {
  const t = useT();
  if (hasReadyAccount(connections)) return null;
  const pick = (kind: "cli" | "api-key" | "local") => {
    const found = connections.find((c) => {
      if (kind === "local") return c.provider === "ollama" && c.residence === "local";
      return specOf(c).credential.kind === kind;
    });
    if (found) onChoose(found.id);
  };
  return (
    <section aria-label={t("providers.first.title")} className="mx-4 mt-4 rounded-panel border border-line-soft p-4">
      <h2 className="t-title text-ink">{t("providers.first.title")}</h2>
      <p className="t-body mt-1 text-ink-dim">{t("providers.first.body")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => pick("cli")}>{t("providers.first.subscription")}</Button>
        <Button onClick={() => pick("api-key")}>{t("providers.first.apiKey")}</Button>
        <Button onClick={() => pick("local")}>{t("providers.first.local")}</Button>
      </div>
    </section>
  );
}
