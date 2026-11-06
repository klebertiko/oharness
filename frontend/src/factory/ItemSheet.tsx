"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Input, Notice, Sheet } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { forjaApi } from "./forjaApi";
import type { FactoryAction, WorkItem, WorkItemArtifact, WorkItemEvent } from "./types";
import { useExplain } from "./useForja";
import { actionsFor, statusTone } from "./view";

type Detail = WorkItem & { artifacts: WorkItemArtifact[]; runs: { run_id: string; stage: string; agent_id: string | null }[] };

/**
 * One work item: where it is, its spec (with the approval of the revision a person is looking at), what happened and what a person can
 * do. Text that came from outside is shown as data in its own block and is never an instruction. There is no merge action (ADR 0055).
 */
export function ItemSheet({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, number } = useI18n();
  const explain = useExplain();
  const [item, setItem] = useState<Detail | null>(null);
  const [events, setEvents] = useState<WorkItemEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [detail, history] = await Promise.all([forjaApi.item(id), forjaApi.events(id)]);
      setItem(detail);
      setEvents(history.events);
    } catch (e) {
      setError(explain(e));
    }
  }, [id, explain]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: FactoryAction) => {
    if (!item) return;
    const body: { action: FactoryAction } & Record<string, unknown> = { action };
    if (action === "approve_spec") body.revision = item.spec.revision;
    if (action === "note") body.text = note;
    if (action === "request_changes") body.note = note;
    try {
      await forjaApi.act(id, body);
      setError(null);
      setNote("");
      await load();
      onChanged();
    } catch (e) {
      setError(explain(e));
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title={item?.title ?? t("forja.loading")} showClose>
      {item && (
        <div className="flex flex-col gap-4 p-4 text-body">
          {error && <Notice tone="warn">{error}</Notice>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-ink-dim">{t("forja.item.stage")}</dt>
            <dd>{item.stage}</dd>
            <dt className="text-ink-dim">{t("forja.item.status")}</dt>
            <dd>
              <Badge tone={statusTone(item.status)}>{item.status}</Badge>
            </dd>
            <dt className="text-ink-dim">{t("forja.item.source")}</dt>
            <dd>{item.source.kind}</dd>
            <dt className="text-ink-dim">{t("forja.item.cost")}</dt>
            <dd>{number(item.cost.tokens)}</dd>
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
          <List title={t("forja.item.runs")} id="forja-runs" empty={t("forja.item.none")} rows={item.runs.map((r) => `${r.stage} · ${r.agent_id ?? "–"} · ${r.run_id}`)} />
          <List title={t("forja.item.history")} id="forja-history" empty={t("forja.item.none")} rows={events.map((e) => `${e.at.slice(0, 16).replace("T", " ")} · ${e.actor.kind} · ${e.type}`)} />
          <div className="flex flex-col gap-2">
            <Input label={t("forja.item.noteLabel")} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {actionsFor(item).map((action) => (
                <Button key={action} variant={action === "approve_spec" ? "primary" : action === "cancel" ? "danger" : "secondary"} size="sm" onClick={() => void act(action)} disabled={action === "note" && !note.trim()}>
                  {t(`forja.action.${action}` as MessageKey)}
                </Button>
              ))}
            </div>
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
