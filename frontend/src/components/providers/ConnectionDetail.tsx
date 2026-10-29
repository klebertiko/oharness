"use client";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Notice, Panel, Skeleton, StatusMark } from "@/components/ui";
import { useT } from "@/i18n/store";
import { Monogram } from "./atoms";
import { ActivityPanel } from "./ActivityPanel";
import { ConnectionPanel } from "./ConnectionPanel";
import { PROVIDER_TEXT_KEY } from "./labels";
import { ModelsPanel } from "./ModelsPanel";
import { providerKey } from "./providerText";
import { specOf, type Connection } from "./providerStore";
import { WithCode } from "./rows";
import { useConnectionActions } from "./useConnectionActions";
import { useUsageStore } from "./usageStore";
import { metaLine, viewOf } from "./view";

/** The store's detail often opens by restating the status word ("Not connected. Add a key…"); the header already says it. */
const withoutStatus = (detail: string, status: string) => (detail.startsWith(`${status}.`) ? detail.slice(status.length + 1).trim() : detail);

export function DetailSkeleton() {
  return (
    <div className="space-y-4 p-4 @md:p-6" aria-hidden>
      <Skeleton className="h-16 w-full max-w-[36rem]" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

/**
 * One connection, in reading order: who it is and whether it answers, the one
 * thing that would make it answer (a single primary button, only when
 * something is missing), then Connection, Models, Activity and About. When
 * what is missing is a key, the key field in Connection is the action, so the
 * header carries no second primary.
 */
export function ConnectionDetail({ c, offline, onBack }: { c: Connection; offline: boolean; onBack?: () => void }) {
  const t = useT();
  const spec = specOf(c);
  const actions = useConnectionActions(c);
  const hydrateUsage = useUsageStore((s) => s.hydrate);
  const usage = useUsageStore((s) => s.summary?.byConnection?.find((u) => u.connectionId === c.id));
  useEffect(() => {
    void hydrateUsage();
  }, [hydrateUsage]);

  const view = viewOf(c, offline);
  const { step, readiness } = view;
  const probing = c.health === "probing";
  const detail = offline ? t("detail.offline") : withoutStatus(c.detail, readiness.label);
  const keyIsTheAction = step?.kind === "paste";
  const showTest = !offline && c.enabled && (!step || step.kind === "model" || step.kind === "replaceKey" || step.thenRetest);
  const agentOnly = spec.catalogue === "agent-only";
  const textKeys = PROVIDER_TEXT_KEY[providerKey(c)];
  const primaryWord = step && actions.copied === step.copy && step.copy ? t("action.copied") : step?.label;

  return (
    <div className="@container flex h-full min-h-0 flex-col" aria-busy={probing || undefined}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[48rem] space-y-4 px-4 py-4 @md:px-6 @md:py-6">
          {onBack && (
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} aria-hidden />} onClick={onBack} className="-ml-2 @2xl:hidden">
              {t("detail.back")}
            </Button>
          )}
          <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 flex-[1_1_18rem] items-start gap-3">
              <Monogram text={spec.monogram} live={readiness.verified} size="lg" />
              <div className="min-w-0">
                <h2 className="t-display text-display text-ink wrap-anywhere">{c.label}</h2>
                <p className="t-body mt-1 flex items-center gap-2" aria-live="polite">
                  <StatusMark tone={view.tone} />
                  <span className={`font-medium ${view.text}`}>{view.status}</span>
                </p>
                {detail && <p className="t-body mt-1 max-w-[62ch] text-ink-dim">{detail}</p>}
                <p className="t-body mt-1 text-ink-mute">{metaLine(c)}</p>
              </div>
            </div>
            {!offline && (
              <div className="flex flex-wrap items-center gap-2">
                {step && !keyIsTheAction && (
                  <Button variant="primary" onClick={() => actions.runStep()} loading={probing && step.kind === "retest"}>
                    {primaryWord}
                  </Button>
                )}
                {showTest && (
                  <Button onClick={() => void actions.test()} loading={probing && !(step?.kind === "retest")}>
                    {step?.thenRetest || step?.kind === "replaceKey" ? t("action.testAgain") : t("action.test")}
                  </Button>
                )}
              </div>
            )}
          </header>

          {probing && !offline && (
            <p role="status" className="t-body text-ink-dim">
              {t("detail.testing")}
            </p>
          )}

          {offline ? (
            <Notice tone="info">{t("detail.offlineBody")}</Notice>
          ) : (
            <>
              <ConnectionPanel c={c} actions={actions} />
              {agentOnly ? <HandoffPanel /> : <ModelsPanel c={c} />}
              <ActivityPanel c={c} usage={usage} />
            </>
          )}

          <Panel title={t("about.title", { vendor: spec.vendor })} titleId="oh-about" level={3}>
            <div className="space-y-3 p-3">
              <p className="t-body max-w-[62ch] text-ink-dim">
                <WithCode text={t(textKeys.summary)} />
              </p>
              <p className="t-body text-ink-dim">{t(c.residence === "local" ? "about.local" : "about.cloud", { vendor: spec.vendor })}</p>
              {textKeys.caveat && (
                <Notice tone="info">
                  <WithCode text={t(textKeys.caveat)} />
                </Notice>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function HandoffPanel() {
  const t = useT();
  return (
    <Panel title={t("handoff.title")} titleId="oh-handoff" level={3}>
      <div className="grid gap-3 p-3 @md:grid-cols-2">
        {(["cloud", "local"] as const).map((k) => (
          <div key={k} className="rounded-control border border-line-soft bg-sub-200 p-3">
            <p className="t-title text-ink">{t(`handoff.${k}.title`)}</p>
            <p className="t-meta mt-1 break-all text-ink-mute">{t(`handoff.${k}.cmd`)}</p>
            <p className="t-body mt-2 text-ink-dim">{t(`handoff.${k}.body`)}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
