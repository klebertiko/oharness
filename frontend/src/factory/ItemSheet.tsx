"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, ConfirmInline, Input, Notice, Sheet } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { forjaApi, ForjaError } from "./forjaApi";
import type { FactoryAction, WorkItem, WorkItemArtifact, WorkItemEvent } from "./types";
import { useExplain } from "./useForja";
import { actionsFor, ageParts, eventKey, label, openQuestion, sourceKey, statusTone } from "./view";
import { formatDate } from "@/i18n/translate";

type Detail = WorkItem & { artifacts: WorkItemArtifact[]; runs: { run_id: string; stage: string; agent_id: string | null }[] };

/**
 * One work item: where it is, its spec (with the approval of the revision a person is looking at), what happened and what a person can
 * do. Text that came from outside is shown as data in its own block and is never an instruction. There is no merge action (ADR 0055).
 */
export function ItemSheet({ id, live = null, onClose, onChanged }: { id: string; live?: { run_id: string } | null; onClose: () => void; onChanged: () => void }) {
  const { t, number, locale } = useI18n();
  const explain = useExplain();
  const [item, setItem] = useState<Detail | null>(null);
  const [events, setEvents] = useState<WorkItemEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [answer, setAnswer] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [steer, setSteer] = useState("");
  const [decidingNetwork, setDecidingNetwork] = useState(false);
  const loading = useRef({ id, active: false, inFlight: false, generation: 0 });

  const load = useCallback(async () => {
    const state = loading.current;
    if (!state.active || state.id !== id || state.inFlight) return;
    state.inFlight = true;
    const generation = state.generation;
    try {
      const [detail, history] = await Promise.all([forjaApi.item(id), forjaApi.events(id)]);
      if (!state.active || state.generation !== generation) return;
      setItem(detail);
      setEvents(history.events);
      setFailed(false);
    } catch (e) {
      if (!state.active || state.generation !== generation) return;
      setError(explain(e));
      setFailed(true);
    } finally {
      if (state.generation === generation) state.inFlight = false;
    }
  }, [id, explain]);
  useEffect(() => {
    const state = loading.current;
    state.id = id;
    state.active = true;
    state.inFlight = false;
    state.generation += 1;
    void load();
    const timer = window.setInterval(() => void load(), 1500);
    return () => {
      window.clearInterval(timer);
      state.active = false;
      state.generation += 1;
    };
  }, [id, load]);

  const act = async (action: FactoryAction) => {
    if (!item) return;
    const body: { action: FactoryAction } & Record<string, unknown> = { action };
    if (action === "approve_spec") body.revision = item.spec.revision;
    if (action === "note") body.text = note;
    if (action === "answer") {
      body.text = answer;
      body.question_id = openQuestion(events)?.id;
    }
    if (action === "request_changes") body.note = note;
    try {
      await forjaApi.act(id, body);
      setError(null);
      setNote("");
      setAnswer("");
      setConfirming(false);
      await load();
      onChanged();
    } catch (e) {
      setError(explain(e));
    }
  };

  const [choices, setChoices] = useState<{ id: string; name: string; root_path: string }[] | null>(null);
  // Only a registered project whose definition is this item's Forja; with more than one, the person picks.
  const startRun = async (repo?: string) => {
    try {
      if (!repo) {
        const { repositories } = await forjaApi.itemRepositories(id);
        if (repositories.length === 0) {
          setError(t("forja.runs.noProject"));
          return;
        }
        if (repositories.length > 1) {
          setChoices(repositories);
          return;
        }
        repo = repositories[0].root_path;
      }
      setChoices(null);
      await forjaApi.startRun(id, repo);
      setError(null);
      await load();
      onChanged();
    } catch (e) {
      setError(explain(e));
    }
  };
  const control = async (run: () => Promise<unknown>) => {
    try {
      await run();
      setError(null);
      setSteer("");
      onChanged();
    } catch (e) {
      setError(explain(e));
    }
  };

  const unansweredQuestion = openQuestion(events);
  const question = item && item.status === "awaiting_human" ? unansweredQuestion : null;
  const pendingNetwork = item?.network?.pending;
  const decideNetwork = async (decision: "once" | "host" | "deny") => {
    if (!pendingNetwork || decidingNetwork) return;
    setDecidingNetwork(true);
    try {
      await forjaApi.approveNetwork(id, pendingNetwork.id, decision);
      setError(null);
      await load();
      onChanged();
    } catch (e) {
      if (e instanceof ForjaError && e.status === 409) {
        setError(t("forja.network.stale"));
        await load();
      } else setError(explain(e));
    } finally {
      setDecidingNetwork(false);
    }
  };
  const source = item ? sourceKey(item) : null;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title={item?.title ?? t("forja.loading")} showClose>
      {!item && failed && (
        <div className="p-4">
          <Notice tone="fault" title={t("forja.item.loadFailed")} action={<Button size="sm" onClick={() => void load()}>{t("forja.retry")}</Button>}>
            {error}
          </Notice>
        </div>
      )}
      {item && source && (
        <div className="flex flex-col gap-4 p-4 text-body">
          {error && <Notice tone="warn">{error}</Notice>}
          {item.network?.mode === "supervised" && <Notice tone="warn" title={t("forja.network.supervised")}>{t(item.network.isolation === "none" ? "forja.network.noIsolation" : "forja.network.supervisedBody")}</Notice>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-ink-dim">{t("forja.item.stage")}</dt>
            <dd>{label(t, `forja.stage.${item.stage}`, item.stage)}</dd>
            <dt className="text-ink-dim">{t("forja.item.status")}</dt>
            <dd>
              <Badge tone={statusTone(item.status)}>{label(t, `forja.status.${item.status}`, item.status)}</Badge>
            </dd>
            <dt className="text-ink-dim">{t("forja.item.source")}</dt>
            <dd>{t(source.key, source.n ? { n: source.n } : undefined)}</dd>
            <dt className="text-ink-dim">{t("forja.item.cost")}</dt>
            <dd>{t("forja.item.tokens", { n: number(item.cost.tokens) })}</dd>
          </dl>
          <section aria-labelledby="forja-spec">
            <h3 id="forja-spec" className="mb-1 text-title">
              {t("forja.item.spec")}
            </h3>
            {item.spec.text ? (
              <>
                <p className="mb-1 text-ink-dim">
                  {t("forja.item.specRevision", { n: item.spec.revision })}
                  {item.spec.approved_revision === item.spec.revision ? ` · ${t("forja.item.specApproved")}` : ""}
                </p>
                <pre className="whitespace-pre-wrap rounded-control border border-line-soft bg-sub-200 p-2">{item.spec.text}</pre>
              </>
            ) : (
              <p className="text-ink-mute">{t("forja.item.specEmpty")}</p>
            )}
          </section>
          <section aria-labelledby="forja-origin">
            <h3 id="forja-origin" className="mb-1 text-title">
              {t("forja.item.origin")}
            </h3>
            <pre className="whitespace-pre-wrap rounded-control border border-line-soft bg-sub-200 p-2">{item.origin_context.text || "–"}</pre>
          </section>
          <List title={t("forja.item.artifacts")} id="forja-artifacts" empty={t("forja.item.none")} rows={item.artifacts.map((a) => `${a.kind}: ${a.ref}`)} />
          <List title={t("forja.item.runs")} id="forja-runs" empty={t("forja.item.none")} rows={item.runs.map((r) => `${label(t, `forja.stage.${r.stage}`, r.stage)} · ${r.agent_id ?? t("forja.item.none")}`)} />
          <section aria-labelledby="forja-history">
            <h3 id="forja-history" className="mb-1 text-title">{t("forja.item.history")}</h3>
            {events.length === 0 ? <p className="text-ink-mute">{t("forja.item.none")}</p> : (
              <ul className="flex max-h-40 flex-col gap-0.5 overflow-auto text-ink-dim">
                {events.map((event) => {
                  const age = ageParts(event.at);
                  const when = age ? (age.n == null ? t(age.key) : t(age.key, { n: number(age.n) })) : "";
                  const absolute = Number.isNaN(Date.parse(event.at)) ? "" : formatDate(locale, new Date(event.at));
                  return <li key={event.sequence} title={absolute}>{when} · {t(eventKey(event))}</li>;
                })}
              </ul>
            )}
          </section>
          {(pendingNetwork || unansweredQuestion?.network) && (
            <section aria-labelledby="forja-network" className="flex flex-col gap-2">
              <h3 id="forja-network" className="text-title">{t("forja.network.review")}</h3>
              {pendingNetwork ? <>
                <p className="text-ink-dim">{pendingNetwork.reason}</p>
                <p className="text-ink-dim">{t("forja.network.command")}</p>
                <pre className="whitespace-pre-wrap break-all rounded-control border border-line-soft bg-sub-200 p-2">{JSON.stringify(pendingNetwork.argv)}</pre>
                <p className="text-ink-dim">{t("forja.network.hosts")}</p>
                {pendingNetwork.hosts.length ? <ul>{pendingNetwork.hosts.map((host) => <li key={host}>{host}</li>)}</ul> : <p>{t("forja.network.unknownHost")}</p>}
                {pendingNetwork.can_remember && <p className="text-ink-dim">{t("forja.network.hostScope")}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" disabled={decidingNetwork} onClick={() => void decideNetwork("once")}>{t("forja.network.once")}</Button>
                  {pendingNetwork.can_remember && <Button size="sm" disabled={decidingNetwork} onClick={() => void decideNetwork("host")}>{t("forja.network.host")}</Button>}
                  <Button size="sm" variant="danger" disabled={decidingNetwork} onClick={() => void decideNetwork("deny")}>{t("forja.network.deny")}</Button>
                </div>
              </> : <Notice tone="warn">{t("forja.network.expired")}</Notice>}
            </section>
          )}
          {question && !question.network && !pendingNetwork && (
            <section aria-labelledby="forja-question" className="flex flex-col gap-2">
              <h3 id="forja-question" className="text-title">
                {t("forja.item.question")}
              </h3>
              <p className="text-ink-dim">{question.text}</p>
              <Input label={t("forja.item.answerLabel")} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <div>
                <Button size="sm" variant="primary" disabled={!answer.trim()} onClick={() => void act("answer")}>
                  {t("forja.action.answer")}
                </Button>
              </div>
            </section>
          )}
          {live && (
            <section aria-labelledby="forja-live" className="flex flex-col gap-2">
              <h3 id="forja-live" className="text-title">{t("forja.tab.runs")}</h3>
              <Input label={t("forja.runs.steerHint")} value={steer} onChange={(e) => setSteer(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!steer.trim()} onClick={() => void control(() => forjaApi.steerRun(live.run_id, steer.trim()))}>{t("forja.runs.steer")}</Button>
                <Button size="sm" variant="danger" onClick={() => void control(() => forjaApi.stopRun(live.run_id))}>{t("forja.runs.stop")}</Button>
              </div>
            </section>
          )}
          {item.stage === "implement" && item.status === "queued" && !live && (
            <div>
              <Button size="sm" variant="primary" onClick={() => void startRun()}>{t("forja.runs.start")}</Button>
              {choices && (
                <fieldset className="mt-2 flex flex-wrap gap-2">
                  <legend className="text-body text-ink-dim">{t("forja.runs.pickProject")}</legend>
                  {choices.map((choice) => (
                    <Button key={choice.id} size="sm" title={choice.root_path} onClick={() => void startRun(choice.root_path)}>
                      {t("forja.runs.startIn", { name: choice.name })}
                    </Button>
                  ))}
                </fieldset>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Input label={t("forja.item.noteLabel")} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {actionsFor(item).map((action) => (
                <Button key={action} variant={action === "approve_spec" ? "primary" : action === "cancel" ? "danger" : "secondary"} size="sm" onClick={() => (action === "cancel" ? setConfirming(true) : void act(action))} disabled={action === "note" && !note.trim()}>
                  {label(t, `forja.action.${action}`, action)}
                </Button>
              ))}
            </div>
            {confirming && <ConfirmInline prompt={t("forja.confirm.cancel")} confirmLabel={t("forja.confirm.cancelYes")} onConfirm={() => void act("cancel")} onCancel={() => setConfirming(false)} />}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function List({ title, id, rows, empty }: { title: string; id: string; rows: string[]; empty: string }) {
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="mb-1 text-title">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-ink-mute">{empty}</p>
      ) : (
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-auto text-ink-dim">
          {rows.map((row, i) => (
            <li key={i}>{row}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
