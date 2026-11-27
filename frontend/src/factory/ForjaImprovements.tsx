"use client";
import { useId, useState } from "react";
import { Badge, Button, EmptyState, Input, Notice, Segmented, SkeletonRows } from "@/components/ui";
import { en } from "@/i18n/messages.en";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { type FailureRow, forjaApi, type Proposal, type TrailEvent } from "./forjaApi";
import { OfflineNotice } from "./Offline";
import { useExplain, useLoad } from "./useForja";
import { ageParts } from "./view";

type Tab = "proposals" | "canary" | "history" | "scorers";
const FACTORY_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A key built from data the server sent is only used when the catalog has it; otherwise the caller's plain text is shown. */
export function knownKey(key: string): MessageKey | null {
  return key in en ? (key as MessageKey) : null;
}

/** Proposals a person decides. Nothing here starts a trial, promotes or changes code without that decision. */
export function ForjaImprovements() {
  const { t } = useI18n();
  const explain = useExplain();
  const listId = useId();
  const [tab, setTab] = useState<Tab>("proposals");
  const [factory, setFactory] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const valid = factory === "" || FACTORY_ID.test(factory);
  const { result, reload } = useLoad(() => forjaApi.improvements(factory && valid ? factory : undefined));
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
  const known = [...new Set(data.proposals.map((proposal) => proposal.factory_id))].sort();
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
        <Input
          label={t("forja.improve.factory")}
          list={listId}
          value={factory}
          error={valid ? undefined : t("forja.improve.factoryInvalid")}
          onChange={(event) => setFactory(event.target.value.trim())}
        />
        <datalist id={listId}>{known.map((id) => <option key={id} value={id} />)}</datalist>
        <Button size="sm" disabled={!factory || !valid} onClick={() => void act(() => forjaApi.runImprovement(factory, true))}>{t("forja.improve.runNow")}</Button>
        <Button size="sm" disabled={!valid} onClick={() => void act(() => downloadTrail(factory && valid ? factory : undefined))}>{t("forja.improve.export")}</Button>
      </div>
      {message && <Notice tone="warn">{message}</Notice>}
      {tab === "scorers" ? (
        <Scorers failures={data.failures} />
      ) : shown.length === 0 ? (
        <EmptyState title={t("forja.improve.empty")}>{t("forja.improve.emptyBody")}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} trail={data.events.filter((event) => event.proposal_id === proposal.id)} act={act} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every page of the trail, saved as one JSON file. */
async function downloadTrail(factory: string | undefined): Promise<void> {
  const events: TrailEvent[] = [];
  let after: number | null = null;
  do {
    const page: { events: TrailEvent[]; next: number | null } = await forjaApi.exportTrail(factory, after);
    events.push(...page.events);
    after = page.next;
  } while (after !== null);
  const blob = new Blob([JSON.stringify({ factory_id: factory ?? null, events }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `forja-improvements-${factory ?? "all"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function ProposalCard({ proposal, trail, act }: { proposal: Proposal; trail: TrailEvent[]; act: (run: () => Promise<unknown>) => Promise<void> }) {
  const { t, number, plural } = useI18n();
  const age = proposal.created_at ? ageParts(proposal.created_at) : null;
  const ageLabel = age ? (age.n == null ? t(age.key) : t(age.key, { n: number(age.n) })) : "";
  const statusKey = knownKey(`forja.improve.status.${proposal.status}`);
  const verdictKey = proposal.verdict ? knownKey(`forja.improve.verdict.${proposal.verdict}`) : null;
  const run = (call: () => Promise<unknown>) => void act(call);
  return (
    <li className="flex flex-col gap-2 rounded-panel border border-line-soft bg-sub-100 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={proposal.status === "rejected" || proposal.verdict === "worsened" ? "fault" : "warn"}>{statusKey ? t(statusKey) : proposal.status}</Badge>
        <span className="text-title text-ink">{proposal.justification || t("forja.improve.untitled")}</span>
        <span className="text-body text-ink-dim">{ageLabel}</span>
      </div>
      <p className="text-body text-ink-dim">
        {plural("forja.improve.regressions", proposal.failure_ids.length)} · {t(proposal.target === "code" ? "forja.improve.target.code" : "forja.improve.target.definition")}
        {proposal.estimated_tokens != null && <> · {t("forja.improve.cost", { n: number(proposal.estimated_tokens) })}</>}
      </p>
      {proposal.diff.length > 0 && (
        <details>
          <summary className="cursor-pointer text-body text-ink">{plural("forja.improve.diff", proposal.diff.length)}</summary>
          <ul className="mt-1 font-mono text-body text-ink-dim">
            {proposal.diff.map((change, index) => <li key={`${change.path}:${index}`}>{t("forja.improve.diffRow", { op: diffOp(t, change.op), path: change.path })}</li>)}
          </ul>
        </details>
      )}
      {proposal.reasons.length > 0 && (
        <ul>
          {proposal.reasons.map((reason, index) => {
            const key = knownKey(`forja.improve.reason.${reason.code}`);
            return <li key={`${reason.code}:${reason.path}:${index}`} className="text-body text-fault-text">{key ? t(key) : reason.message} <span className="font-mono text-ink-dim">{reason.path}</span></li>;
          })}
        </ul>
      )}
      {verdictKey && <p className="text-body">{t(verdictKey)}</p>}
      {trail.length > 0 && (
        <details>
          <summary className="cursor-pointer text-body text-ink">{plural("forja.improve.trail", trail.length)}</summary>
          <ol className="mt-1 text-body text-ink-dim">
            {trail.map((event) => {
              const key = knownKey(`forja.improve.event.${event.type}`);
              return <li key={event.id}>{key ? t(key) : event.type}{event.actor ? ` · ${actorLabel(t, event.actor.kind)}` : ""}</li>;
            })}
          </ol>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {proposal.status === "pending" && (
          <>
            <Button size="sm" variant="primary" onClick={() => run(() => forjaApi.decideProposal(proposal.id, "approve"))}>{t("forja.improve.approve")}</Button>
            <Button size="sm" onClick={() => run(() => forjaApi.decideProposal(proposal.id, "request_changes"))}>{t("forja.improve.changes")}</Button>
            <Button size="sm" variant="danger" onClick={() => run(() => forjaApi.decideProposal(proposal.id, "reject"))}>{t("forja.improve.reject")}</Button>
          </>
        )}
        {proposal.status === "canary" && (
          <>
            <Button size="sm" onClick={() => run(() => forjaApi.measureProposal(proposal.id))}>{t("forja.improve.measure")}</Button>
            {proposal.verdict === "improved" && <Button size="sm" variant="primary" onClick={() => run(() => forjaApi.promoteProposal(proposal.id))}>{t("forja.improve.promote")}</Button>}
          </>
        )}
        {(proposal.status === "canary" || proposal.status === "promoted") && (
          <Button size="sm" variant="danger" onClick={() => run(() => forjaApi.revertProposal(proposal.id))}>{t("forja.improve.revert")}</Button>
        )}
      </div>
    </li>
  );
}

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

function diffOp(t: T, op: string): string {
  const key = knownKey(`forja.improve.op.${op}`);
  return key ? t(key) : op;
}

function actorLabel(t: T, kind: string): string {
  const key = knownKey(`forja.improve.actor.${kind}`);
  return key ? t(key) : kind;
}

function Scorers({ failures }: { failures: FailureRow[] }) {
  const { t } = useI18n();
  if (failures.length === 0) return <EmptyState title={t("forja.improve.noScores")}>{t("forja.improve.noScoresBody")}</EmptyState>;
  return (
    <ul className="flex flex-col gap-2">
      {failures.map((failure) => {
        const check = knownKey(`forja.improve.check.${failure.reason}`);
        return (
          <li key={failure.id} className="flex flex-wrap items-center gap-2 text-body text-ink">
            <span>{check ? t(check) : t("forja.improve.checkOther")}</span>
            {failure.agent_id && <span className="text-ink-dim">{t("forja.improve.failureAgent", { agent: failure.agent_id })}</span>}
            {failure.run_id && <span className="font-mono text-ink-dim">{failure.run_id}</span>}
            {failure.superseded && <Badge tone="neutral">{t("forja.improve.superseded")}</Badge>}
          </li>
        );
      })}
    </ul>
  );
}

