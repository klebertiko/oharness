"use client";
import { useState } from "react";
import { Badge, EmptyState, SkeletonRows } from "@/components/ui";
import type { MessageKey } from "@/i18n/translate";
import { useI18n } from "@/i18n/store";
import { OfflineNotice } from "./Offline";
import { forjaApi } from "./forjaApi";
import type { WorkItem } from "./types";
import { useLoad } from "./useForja";
import { ageParts, displayColumn, groupByDisplay, label, moveReason, sourceKey, statusTone, type DisplayColumn } from "./view";

/** Work items in six stage columns. A drag that the blueprint does not allow explains why and leaves the card where it is. */
export function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const { result, reload } = useLoad(() => forjaApi.items());
  const [reason, setReason] = useState<string | null>(null);
  if (result.state === "offline") return <OfflineNotice onRetry={reload} />;
  if (result.state === "loading") return <SkeletonRows />;
  const items = result.data.items.filter((item) => item.status !== "cancelled");
  if (items.length === 0) return <EmptyState title={t("forja.board.empty")}>{t("forja.board.emptyBody")}</EmptyState>;
  const groups = groupByDisplay(items);
  const drop = (from: DisplayColumn, to: DisplayColumn) => {
    const verdict = moveReason(from, to);
    if (verdict === "blocked") setReason(t("forja.move.blocked"));
    else if (verdict === "allowed") setReason(t("forja.move.checkpoint"));
    else setReason(null);
  };
  return (
    <div className="flex min-w-0 flex-col gap-3 p-3">
      {reason && <p role="status" className="text-body text-ink-dim">{reason}</p>}
      <div className="flex min-w-0 gap-3 overflow-x-auto pb-2">
        {[...groups.entries()].map(([column, list]) => (
          <Column key={column} column={column} list={list} onOpen={onOpen} onDrop={drop} />
        ))}
      </div>
    </div>
  );
}

function Column({ column, list, onOpen, onDrop }: { column: DisplayColumn; list: WorkItem[]; onOpen: (id: string) => void; onDrop: (from: DisplayColumn, to: DisplayColumn) => void }) {
  const { t, number } = useI18n();
  const name = t(`forja.column.${column}` as MessageKey);
  return (
    <section
      aria-label={t("forja.board.columnCount", { name, n: number(list.length) })}
      className="w-64 shrink-0 rounded-panel border border-line-soft bg-sub-100 p-2"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const from = event.dataTransfer.getData("text/forja-column") as DisplayColumn;
        if (from) onDrop(from, column);
      }}
    >
      <h2 className="mb-2 flex items-center justify-between text-title text-ink">
        {name}
        <span className="text-body text-ink-dim">{number(list.length)}</span>
      </h2>
      {list.length === 0 ? (
        <p className="text-body text-ink-mute">{t(`forja.board.hint.${column}` as MessageKey)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((item) => (
            <Card key={item.id} item={item} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Card({ item, onOpen }: { item: WorkItem; onOpen: (id: string) => void }) {
  const { t, number } = useI18n();
  const source = sourceKey(item);
  const age = ageParts(item.updated_at);
  return (
    <li>
      <button
        type="button"
        draggable
        onDragStart={(event) => event.dataTransfer.setData("text/forja-column", displayColumn(item))}
        onClick={() => onOpen(item.id)}
        aria-label={t("forja.item.open", { title: item.title })}
        className="flex w-full flex-col items-start gap-1 rounded-control border border-line-soft bg-sub-000 p-2 text-left hover:bg-sub-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal min-h-control-touch"
      >
        <span className="text-title text-ink">{item.title}</span>
        <span className="flex flex-wrap items-center gap-2 text-body text-ink-dim">
          <Badge tone={statusTone(item.status)}>{label(t, `forja.status.${item.status}`, item.status)}</Badge>
          {item.network?.mode === "supervised" && <Badge tone="warn">{t("forja.network.supervised")}</Badge>}
          <span>{t(source.key, source.n ? { n: source.n } : undefined)}</span>
          {age && <span>{age.n == null ? t(age.key) : t(age.key, { n: number(age.n) })}</span>}
          <span>{t("forja.item.tokens", { n: number(item.cost.tokens) })}</span>
        </span>
        {item.status === "running" && <span role="progressbar" aria-label={t("forja.item.live")} className="h-1 w-full rounded-control bg-signal" />}
      </button>
    </li>
  );
}
