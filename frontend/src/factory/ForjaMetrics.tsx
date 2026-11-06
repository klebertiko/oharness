"use client";
import { useEffect, useState } from "react";
import { EmptyState, Segmented, SkeletonRows } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { forjaApi, type Metrics } from "./forjaApi";
import { OfflineNotice } from "./Offline";
import { useDuration, useLoad } from "./useForja";

type Group = Record<string, unknown>;

/** The same figures the endpoint serves (ADR 0058): counts and durations only. What the data cannot say is shown as unavailable, with the reason. */
export function ForjaMetrics() {
  const { t, number } = useI18n();
  const duration = useDuration();
  const [window, setWindow] = useState("30d");
  const { result, reload } = useLoad(() => forjaApi.metrics(window));
  useEffect(() => {
    reload();
  }, [window, reload]);
  const picker = (
    <Segmented
      label={t("forja.metrics.window")}
      value={window}
      onChange={setWindow}
      options={[
        { value: "7d", label: t("forja.metrics.7d") },
        { value: "30d", label: t("forja.metrics.30d") },
        { value: "90d", label: t("forja.metrics.90d") },
      ]}
    />
  );
  if (result.state === "offline") return <OfflineNotice onRetry={reload} />;
  if (result.state === "loading") return <div className="p-3">{picker}<SkeletonRows /></div>;
  const m: Metrics = result.data;
  const g = (name: string): Group => (m[name] ?? {}) as Group;
  const n = (value: unknown) => (typeof value === "number" ? number(value) : "–");
  const pct = (value: unknown) => (typeof value === "number" ? number(value, { style: "percent", maximumFractionDigits: 0 }) : "–");
  const dur = (value: unknown) => duration(typeof value === "number" ? value : null);
  const autonomy = g("autonomy");
  const gap = (autonomy.merged_without_human_push ?? {}) as { available?: boolean; reason?: string };
  const empty = (g("throughput").prs_opened ?? 0) === 0 && (g("throughput").items_completed ?? 0) === 0;
  const groups: [string, [string, string][]][] = [
    [t("forja.metrics.throughput"), [[t("forja.metrics.prsOpened"), n(g("throughput").prs_opened)], [t("forja.metrics.prsMerged"), n(g("throughput").prs_merged)], [t("forja.metrics.itemsCompleted"), n(g("throughput").items_completed)]]],
    [t("forja.metrics.cost"), [[t("forja.metrics.medianTokens"), n(g("cost").median_tokens_per_pr)], [t("forja.metrics.totalTokens"), n(g("cost").total_tokens)]]],
    [t("forja.metrics.quality"), [[t("forja.metrics.firstPass"), pct(g("quality").approved_first_review)], [t("forja.metrics.returns"), n(g("quality").avg_returns_to_implement)], [t("forja.metrics.verifyFailures"), n(g("quality").verify_failures)]]],
    [t("forja.metrics.autonomy"), [[t("forja.metrics.interventions"), n(autonomy.human_interventions_per_item)]]],
    [t("forja.metrics.cycle"), [[t("forja.metrics.runToPr"), dur(g("cycle_time").run_to_pr_median_s)], [t("forja.metrics.runToReview"), dur(g("cycle_time").run_to_first_review_median_s)], [t("forja.metrics.runToMerge"), dur(g("cycle_time").run_to_merge_median_s)]]],
  ];
  return (
    <div className="flex flex-col gap-3 p-3">
      {picker}
      {empty && <EmptyState title={t("forja.metrics.noData")} />}
      <div className="grid gap-3 @2xl:grid-cols-2">
        {groups.map(([title, rows]) => (
          <section key={title} aria-label={title} className="rounded-panel border border-line-soft bg-sub-100 p-3">
            <h2 className="mb-2 text-title text-ink">{title}</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-body">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-dim">{label}</dt>
                  <dd className="text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {title === t("forja.metrics.autonomy") && gap.available === false && <p className="mt-2 text-body text-ink-mute">{t("forja.metrics.unavailable", { reason: String(gap.reason ?? "") })}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
