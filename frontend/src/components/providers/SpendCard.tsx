"use client";
import { useEffect, useState } from "react";
import { Button, Input, Notice, StatusMark, type StatusTone } from "@/components/ui";
import { useLocaleStore, useT } from "@/i18n/store";
import { usageCostParts, useUsageStore } from "./usageStore";

const TONE: Record<string, StatusTone> = { unset: "idle", ok: "ok", warning: "warn" };

/** Global spend and budget: the one thing on this screen that is not about a single connection, so it sits under the list. One line, with the editor one click away. */
export function SpendCard() {
  const t = useT();
  const summary = useUsageStore((s) => s.summary);
  const loading = useUsageStore((s) => s.loading);
  const error = useUsageStore((s) => s.error);
  const budgetError = useUsageStore((s) => s.budgetError);
  const locale = useLocaleStore((s) => s.locale);
  const hydrate = useUsageStore((s) => s.hydrate);
  const refresh = useUsageStore((s) => s.refresh);
  const setBudget = useUsageStore((s) => s.setBudget);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const budget = summary?.budget;
  const tone: StatusTone = budget ? (TONE[budget.state] ?? "fault") : "idle";
  const cost = summary ? usageCostParts(summary, locale) : null;
  const spent = !cost ? "—" : cost.kind === "unknown" ? t("spend.unknown") : t("spend.estimated", { amount: cost.amount });

  const save = async () => {
    if (saving) return;
    const text = draft.trim().replace(",", ".");
    if (text !== "" && !/^\d+(\.\d+)?$/.test(text)) return setInvalid(true);
    const n = text === "" ? null : Number(text);
    setInvalid(false);
    setSaving(true);
    try {
      if (await setBudget(n)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label={t("spend.title")} className="border-t border-line-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="t-body font-medium text-ink">{t("spend.title")}</h3>
        <Button size="sm" variant="ghost" loading={loading} onClick={() => void refresh()}>
          {t("spend.refresh")}
        </Button>
      </div>
      <p className="t-body mt-1 flex items-center gap-2 text-ink-dim">
        <StatusMark tone={tone} />
        <span>{spent}</span>
      </p>
      {error && !budgetError && (
        <Notice tone="warn" className="mt-2">
          {t("spend.error")}
        </Notice>
      )}
      {editing ? (
        <div className="mt-2 space-y-2">
          <Input
            compact
            mono
            autoFocus
            disabled={saving}
            inputMode="decimal"
            aria-label={t("spend.field")}
            aria-invalid={invalid || undefined}
            placeholder={t("spend.noLimit")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          {budgetError && (
            <p role="alert" className="t-body text-fault-text">
              {t("spend.saveFailed")}
            </p>
          )}
          {invalid && (
            <p role="alert" className="t-body text-fault-text">
              {t("spend.invalid")}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
              {t("spend.save")}
            </Button>
            <Button size="sm" disabled={saving} onClick={() => {
                setEditing(false);
                setInvalid(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 mt-1 text-ink-mute"
          onClick={() => {
            setDraft(budget?.limitUsd != null ? String(budget.limitUsd) : "");
            setInvalid(false);
            setEditing(true);
          }}
        >
          {budget?.limitUsd != null ? t("spend.budget.of", { limit: `$${budget.limitUsd.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }) : t("spend.budget.set")}
        </Button>
      )}
    </section>
  );
}
