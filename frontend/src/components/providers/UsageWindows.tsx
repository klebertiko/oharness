"use client";

import { useEffect, useState } from "react";
import { useLocaleStore, useT } from "@/i18n/store";
import { apiUrl } from "@/lib/apiBase";
import { specOf, type Connection } from "./providerStore";
import { formatResetLocal } from "./usageLimit";

export type UsageWindow = { usedPct: number; resetsAt?: string };
export type UsageWindowsRow = {
  cli: string;
  provider: string;
  available: boolean;
  fiveHour?: UsageWindow;
  weekly?: UsageWindow;
};

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <meter min={0} max={100} value={pct} aria-label={label} />
      <span>{label}</span>
    </span>
  );
}

/** One subscription's windows. Unavailable is a sentence, never a 0% bar. */
export function UsageWindowLine({ row, name }: { row: UsageWindowsRow; name: string }) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  if (!row.available || (row.fiveHour == null && row.weekly == null)) {
    return <p><span className="font-medium">{name}</span> {t("providers.usage.unavailable")}</p>;
  }
  const reset = formatResetLocal(row.fiveHour?.resetsAt ?? row.weekly?.resetsAt, locale);
  return (
    <p className="flex flex-wrap items-center gap-3">
      <span className="font-medium">{name}</span>
      {row.fiveHour && <Bar pct={row.fiveHour.usedPct} label={t("providers.usage.fiveHour", { pct: row.fiveHour.usedPct })} />}
      {row.weekly && <Bar pct={row.weekly.usedPct} label={t("providers.usage.weekly", { pct: row.weekly.usedPct })} />}
      {reset && <span>{t("providers.usage.resets", { time: reset })}</span>}
    </p>
  );
}

export function UsageStrip({ connections }: { connections: Connection[] }) {
  const t = useT();
  const [rows, setRows] = useState<UsageWindowsRow[]>([]);
  const subscriptions = connections.filter((c) => specOf(c).credential.kind === "cli");
  useEffect(() => {
    if (subscriptions.length === 0) return;
    let gone = false;
    void fetch(apiUrl("/providers/usage-windows"))
      .then((res) => (res.ok ? res.json() : { windows: [] }))
      .then((body: { windows?: UsageWindowsRow[] }) => {
        if (!gone) setRows(body.windows ?? []);
      })
      .catch(() => {
        if (!gone) setRows([]);
      });
    return () => {
      gone = true;
    };
  }, [subscriptions.length]);
  if (subscriptions.length === 0) return null;
  return (
    <section aria-label={t("providers.usage.strip")} className="border-b border-line-soft px-4 py-3">
      <h2 className="t-body font-medium text-ink">{t("providers.usage.strip")}</h2>
      <div className="mt-2 space-y-1 text-ink-dim">
        {subscriptions.map((c) => {
          const row = rows.find((item) => item.provider === c.provider) ?? { cli: "", provider: c.provider, available: false };
          return <UsageWindowLine key={c.id} row={row} name={c.label} />;
        })}
      </div>
    </section>
  );
}
