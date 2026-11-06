"use client";
import { useState } from "react";
import { Badge, EmptyState, SkeletonRows } from "@/components/ui";
import type { MessageKey } from "@/i18n/translate";
import { useI18n } from "@/i18n/store";
import { OfflineNotice } from "./Offline";
import { forjaApi } from "./forjaApi";
import type { FactoryColumn } from "./types";
import { useLoad } from "./useForja";
import { groupByColumn, statusTone } from "./view";

/** The work items by column. Each column is a labelled list and each card a button: the keyboard reaches everything, and nothing is dragged. */
export function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [showClosed, setShowClosed] = useState(false);
  const { result, reload } = useLoad(() => forjaApi.items());
  if (result.state === "offline") return <OfflineNotice onRetry={reload} />;
  if (result.state === "loading") return <SkeletonRows />;
  const items = result.data.items;
  if (items.length === 0) return <EmptyState title={t("forja.board.empty")}>{t("forja.board.emptyBody")}</EmptyState>;
  const groups = groupByColumn(items, showClosed);
  return (
    <div className="flex flex-col gap-3 p-3">
      <label className="flex items-center gap-2 text-body text-ink-dim">
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
        {t("forja.board.showClosed")}
      </label>
      <div className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-4">
        {[...groups.entries()].map(([column, list]) => (
          <Column key={column} column={column} list={list} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function Column({ column, list, onOpen }: { column: FactoryColumn; list: import("./types").WorkItem[]; onOpen: (id: string) => void }) {
  const { t, number } = useI18n();
  const name = t(`forja.column.${column}` as MessageKey);
  return (
    <section aria-label={t("forja.board.columnCount", { name, n: number(list.length) })} className="rounded-panel border border-line-soft bg-sub-100 p-2">
      <h2 className="mb-2 flex items-center justify-between text-title text-ink">
        {name}
        <span className="text-body text-ink-dim">{number(list.length)}</span>
      </h2>
      {list.length === 0 ? (
        <p className="text-body text-ink-mute">{t("forja.board.noneHere")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                aria-label={t("forja.item.open", { title: item.title })}
                className="flex w-full flex-col items-start gap-1 rounded-control border border-line-soft bg-sub-000 p-2 text-left hover:bg-sub-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal min-h-control-touch"
              >
                <span className="text-title text-ink">{item.title}</span>
                <span className="flex flex-wrap items-center gap-2 text-body text-ink-dim">
                  <Badge tone={statusTone(item.status)}>{item.stage}</Badge>
                  <span>{item.source.kind}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
