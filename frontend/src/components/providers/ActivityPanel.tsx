"use client";
import { Notice, Panel } from "@/components/ui";
import { useLocaleStore, useT } from "@/i18n/store";
import type { ConnectionUsage } from "@/lib/usageApi";
import { ProbeTrace } from "./atoms";
import { Row, Rows } from "./rows";
import { providerReadiness } from "@/components/agent/chatProvider";
import { usageCostParts } from "./usageStore";
import type { Connection } from "./providerStore";

const FACT_TEXT = { warn: "text-warn-text", fault: "text-fault-text", signal: "text-signal-text", dim: "text-ink-dim" } as const;

/** Reachability, what the vendor said about the account at the last test, and what this connection has spent. Measured numbers only: with no test or no usage the row says so. */
export function ActivityPanel({ c, usage }: { c: Connection; usage: ConnectionUsage | undefined }) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const readiness = providerReadiness(c);
  const ok = c.probes.filter((p) => p.ok);
  const median = ok.length ? [...ok].sort((a, b) => a.ms - b.ms)[Math.floor(ok.length / 2)].ms : null;
  const used = usage && usage.tokensTotal > 0;
  const cost = used ? usageCostParts(usage, locale) : null;
  const when = c.lastProbe ? new Date(c.lastProbe).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "";
  return (
    <Panel title={t("activity.title")} titleId="oh-activity" level={3}>
      <Rows label={t("activity.title")}>
        <Row label={t("activity.reach")}>
          <p className="t-body flex flex-wrap items-center gap-2 text-ink">
            <ProbeTrace probes={c.probes} tone={readiness.tone} />
            {median !== null ? <span>{t("activity.reach.value", { ms: median })}</span> : <span className="text-ink-mute">{t("activity.reach.never")}</span>}
          </p>
          {c.probes.length > 0 && (
            <p className="t-body mt-0.5 text-ink-mute">
              {t("activity.reach.note", { ok: ok.length, total: c.probes.length })}
              {when ? ` · ${t("activity.last", { when })}` : ""}
            </p>
          )}
        </Row>
        {c.facts.map((f, i) => (
          <Row key={`${f.k}-${i}`} label={f.k}>
            <p className={`t-meta wrap-anywhere ${FACT_TEXT[f.tone ?? "dim"]}`}>{f.v}</p>
          </Row>
        ))}
        <Row label={t("activity.tokens")}>
          <p className="t-meta text-ink">{used ? usage.tokensTotal.toLocaleString(locale) : "—"}</p>
          {!used && <p className="t-body mt-0.5 text-ink-mute">{t("activity.none")}</p>}
        </Row>
        {used && cost && (
          <Row label={t("activity.spent")}>
            <p className="t-body text-ink">{cost.kind === "unknown" ? t("spend.unknown") : t("spend.estimated", { amount: cost.amount })}</p>
            <p className="t-body mt-0.5 text-ink-mute">{t("activity.estimate")}</p>
          </Row>
        )}
      </Rows>
      {used && usage.unpricedTokens > 0 && c.residence !== "local" && (
        <div className="px-3 pb-3">
          <Notice tone="warn" title={t("activity.unpriced")}>
            {t("activity.unpriced.note", { n: usage.unpricedTokens.toLocaleString() })}
          </Notice>
        </div>
      )}
    </Panel>
  );
}
