"use client";
import { useState } from "react";
import { Badge, Button, EmptyState, Input, Notice, Segmented, SkeletonRows } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { forjaApi, type Proposal } from "./forjaApi";
import { OfflineNotice } from "./Offline";
import { useExplain, useLoad } from "./useForja";
import { ageParts } from "./view";

type Tab = "proposals" | "canary" | "history" | "scorers";

/** Proposals a person decides. Nothing here starts a trial or changes code without that decision. */
export function ForjaImprovements() {
  const { t, number } = useI18n();
  const explain = useExplain();
  const [tab, setTab] = useState<Tab>("proposals");
  const [factory, setFactory] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [runId, setRunId] = useState("");
  const { result, reload } = useLoad(() => forjaApi.improvements(factory || undefined));
  if (result.state === "offline") return <OfflineNotice onRetry={reload} />;
  if (result.state === "loading") return <SkeletonRows />;
  const data = result.data;
  const act = async (run: () => Promise<unknown>) => {
    try {
      await run();
      setMessage(null);
      reload();
    } catch (error) {
      setMessage(explain(error));
    }
  };
  const shown = data.proposals.filter((proposal) => {
    if (tab === "canary") return proposal.status === "canary";
    if (tab === "history") return proposal.status !== "pending";
    if (tab === "proposals") return proposal.status === "pending" || proposal.status === "rejected";
    return false;
  });
  return (
    <div className="flex flex-col gap-3 p-3">
      <Segmented
        label={t("forja.improve.tabs")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "proposals", label: t("forja.improve.tab.proposals") },
          { value: "canary", label: t("forja.improve.tab.canary") },
          { value: "history", label: t("forja.improve.tab.history") },
          { value: "scorers", label: t("forja.improve.tab.scorers") },
        ]}
      />
      <div className="flex flex-wrap items-end gap-2">
        <Input label={t("forja.improve.factory")} compact value={factory} onChange={(event) => setFactory(event.target.value)} />
        <Button size="sm" disabled={!factory} onClick={() => void act(() => forjaApi.runImprovement(factory, true))}>{t("forja.improve.runNow")}</Button>
      </div>
      {message && <Notice tone="warn">{message}</Notice>}
      {tab === "scorers" ? (
        <Scorers failures={data.failures} factory={factory} runId={runId} setRunId={setRunId} onScore={() => void act(() => forjaApi.scoreRun({ factory_id: factory, version_hash: "0".repeat(64), scorer_id: "qa", run_id: runId, check: "qa_rejected", evidence: { qa: "rejected" } }))} />
      ) : shown.length === 0 ? (
        <EmptyState title={t("forja.improve.empty")}>{t("forja.improve.emptyBody")}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} onDecide={(action) => void act(() => forjaApi.decideProposal(proposal.id, action))} ageLabel={(iso) => {
              const age = iso ? ageParts(iso) : null;
              return age ? (age.n == null ? t(age.key) : t(age.key, { n: number(age.n) })) : "";
            }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProposalCard({ proposal, onDecide, ageLabel }: { proposal: Proposal; onDecide: (action: "approve" | "request_changes" | "reject") => void; ageLabel: (iso: string | null) => string }) {
  const { t, number } = useI18n();
  const pending = proposal.status === "pending";
  return (
    <li className="flex flex-col gap-2 rounded-panel border border-line-soft bg-sub-100 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={proposal.status === "rejected" ? "fault" : proposal.verdict === "worsened" ? "fault" : "warn"}>{t(`forja.improve.status.${proposal.status}` as MessageKey)}</Badge>
        <span className="text-title text-ink">{proposal.justification || t("forja.improve.untitled")}</span>
        <span className="text-body text-ink-dim">{ageLabel(proposal.created_at)}</span>
      </div>
      <p className="text-body text-ink-dim">{t("forja.improve.regressions", { n: number(proposal.failure_ids.length) })} · {t(proposal.target === "code" ? "forja.improve.target.code" : "forja.improve.target.definition")}</p>
      {proposal.failure_ids.length > 0 && (
        <ul className="text-body text-ink-dim">
          {proposal.failure_ids.map((id) => <li key={id}>{t("forja.improve.failureLink", { id })}</li>)}
        </ul>
      )}
      {proposal.reasons.length > 0 && (
        <ul>
          {proposal.reasons.map((reason) => <li key={reason.path} className="text-body text-fault-text">{t(`forja.improve.reason.${reason.code}` as MessageKey)}</li>)}
        </ul>
      )}
      {proposal.verdict && <p className="text-body">{t(`forja.improve.verdict.${proposal.verdict}` as MessageKey)}</p>}
      {pending && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => onDecide("approve")}>{t("forja.improve.approve")}</Button>
          <Button size="sm" onClick={() => onDecide("request_changes")}>{t("forja.improve.changes")}</Button>
          <Button size="sm" variant="danger" onClick={() => onDecide("reject")}>{t("forja.improve.reject")}</Button>
        </div>
      )}
    </li>
  );
}

function Scorers({ failures, factory, runId, setRunId, onScore }: { failures: { id: string; reason: string; run_id: string | null }[]; factory: string; runId: string; setRunId: (value: string) => void; onScore: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      {failures.length === 0 ? <EmptyState title={t("forja.improve.noScores")}>{t("forja.improve.noScoresBody")}</EmptyState> : (
        <ul className="flex flex-col gap-2">
          {failures.map((failure) => <li key={failure.id} className="text-body text-ink">{t(`forja.improve.check.${failure.reason}` as MessageKey, { id: failure.run_id ?? failure.id })}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Input label={t("forja.improve.run")} compact value={runId} onChange={(event) => setRunId(event.target.value)} />
        <Button size="sm" disabled={!factory || !runId} onClick={onScore}>{t("forja.improve.score")}</Button>
      </div>
    </div>
  );
}
