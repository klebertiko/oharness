"use client";

import { useState } from "react";
import { Button, Input, Notice, Panel } from "@/components/ui";
import { useT } from "@/i18n/store";
import { apiUrl } from "@/lib/apiBase";
import type { Connection } from "./providerStore";

const POLICIES = ["inherit", "transient", "all"] as const;

/** Advanced options. A rejected save leaves the fields as they are and shows the error. */
export function AdvancedPanel({ c }: { c: Connection }) {
  const t = useT();
  const [policy, setPolicy] = useState<(typeof POLICIES)[number]>("inherit");
  const [cap, setCap] = useState("2");
  const [allow, setAllow] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const save = async () => {
    const retryCap = Number(cap);
    const res = await fetch(apiUrl(`/providers/connections/${encodeURIComponent(c.id)}/advanced`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        retryPolicy: policy,
        retryCap: Number.isInteger(retryCap) ? retryCap : cap,
        allowlist: allow.split(",").map((item) => item.trim()).filter(Boolean),
        models: {},
      }),
    });
    if (!res.ok) {
      setSaved(false);
      setError(t("providers.advanced.rejected"));
      return;
    }
    setError("");
    setSaved(true);
  };
  return (
    <Panel title={t("providers.advanced.title")} titleId="oh-advanced" level={3}>
      <div className="space-y-3 p-3">
        <label className="t-body block text-ink">
          {t("providers.advanced.retry")}
          <select className="mt-1 block rounded-control border border-line-strong bg-sub-000 px-2 py-1" aria-label={t("providers.advanced.retry")} value={policy} onChange={(e) => setPolicy(e.target.value as (typeof POLICIES)[number])}>
            {POLICIES.map((item) => <option key={item} value={item}>{t(`providers.advanced.${item}`)}</option>)}
          </select>
        </label>
        <Input compact aria-label={t("providers.advanced.cap")} value={cap} onChange={(e) => setCap(e.target.value)} />
        <Input compact aria-label={t("providers.advanced.allow")} value={allow} onChange={(e) => setAllow(e.target.value)} />
        {c && <p className="t-body text-ink-mute">{t("providers.advanced.guide")} <a href={`/guides/providers/${c.provider}.md`}>{t("providers.advanced.how")}</a></p>}
        {error && <Notice tone="fault">{error}</Notice>}
        {saved && <p role="status" className="t-body text-ink-dim">{t("providers.advanced.saved")}</p>}
        <Button variant="primary" size="sm" onClick={() => void save()}>{t("providers.advanced.save")}</Button>
      </div>
    </Panel>
  );
}
