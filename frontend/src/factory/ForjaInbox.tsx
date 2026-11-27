"use client";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, EmptyState, Input, Notice, Segmented, SkeletonRows } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { forjaApi, type InboxEntry } from "./forjaApi";
import { OfflineNotice } from "./Offline";
import { useExplain, useLoad } from "./useForja";
import { ageParts, groupInbox } from "./view";

const TONE: Record<InboxEntry["type"], "neutral" | "signal" | "warn" | "fault"> = {
  question: "signal",
  question_answered: "neutral",
  spec_review: "warn",
  handoff_ready: "warn",
  blocked: "fault",
  failed: "fault",
  improvement: "warn",
};

type Filter = "active" | "done" | "blocked" | "failed";
type Period = "today" | "week" | "all";
const UNDO_MS = 5000;

/** What waits for a person, grouped by item. Resolving can be undone for a few seconds. */
export function ForjaInbox({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, plural, number } = useI18n();
  const explain = useExplain();
  const [filter, setFilter] = useState<Filter>("active");
  const [period, setPeriod] = useState<Period>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const { result, reload } = useLoad(() => forjaApi.inbox(true));
  const rows = useRef<InboxEntry[]>([]);
  const index = useRef(0);
  const open = useRef(onOpen);
  open.current = onOpen;
  index.current = current;
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo((id) => (id === undo ? null : id)), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const list = rows.current;
      if (event.key === "j" || event.key === "J") setCurrent((at) => Math.min(Math.max(list.length - 1, 0), at + 1));
      if (event.key === "k" || event.key === "K") setCurrent((at) => Math.max(0, at - 1));
      const row = list[index.current];
      if (!row) return;
      if (event.key === "Enter") open.current(row.work_item_id);
      if ((event.key === "e" || event.key === "E") && !row.resolved) {
        void forjaApi.resolveEntry(row.id).then(() => setUndo(row.id)).then(() => reload()).catch((error: unknown) => setError(explain(error)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [explain, reload]);
  if (result.state === "offline") return <OfflineNotice onRetry={reload} />;
  if (result.state === "loading") return <SkeletonRows />;
  const now = Date.now();
  const visible = result.data.entries.filter((entry) => matches(entry, filter, period, query, now));
  const groups = groupInbox(visible);
  const waiting = result.data.entries.filter((entry) => !entry.resolved && entry.type !== "question_answered").length;
  rows.current = groups.flatMap((group) => group.entries);

  const change = async (run: () => Promise<void>, undoId?: string) => {
    try {
      await run();
      setError(null);
      if (undoId) setUndo(undoId);
      reload();
    } catch (e) {
      setError(explain(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <p role="status" className="text-title">{waiting === 0 ? t("forja.inbox.empty") : plural("forja.inbox.count", waiting)}</p>
      <Segmented
        label={t("forja.inbox.filters")}
        value={filter}
        onChange={setFilter}
        options={[
          { value: "active", label: t("forja.inbox.filter.active") },
          { value: "done", label: t("forja.inbox.filter.done") },
          { value: "blocked", label: t("forja.inbox.filter.blocked") },
          { value: "failed", label: t("forja.inbox.filter.failed") },
        ]}
      />
      <Segmented
        label={t("forja.inbox.period")}
        value={period}
        onChange={setPeriod}
        options={[
          { value: "today", label: t("forja.inbox.period.today") },
          { value: "week", label: t("forja.inbox.period.week") },
          { value: "all", label: t("forja.inbox.period.all") },
        ]}
      />
      <Input label={t("forja.inbox.search")} compact value={query} onChange={(event) => setQuery(event.target.value)} />
      {error && <Notice tone="warn">{error}</Notice>}
      {undo && (
        <Notice tone="info" action={<Button size="sm" onClick={() => void change(async () => { await forjaApi.undoEntry(undo); setUndo(null); })}>{t("forja.inbox.undo")}</Button>}>
          {t("forja.inbox.undoWindow")}
        </Notice>
      )}
      {groups.length === 0 ? (
        <EmptyState title={t("forja.inbox.empty")}>{t("forja.inbox.emptyBody")}</EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.work_item_id} aria-label={group.title} className="flex flex-col gap-2 rounded-panel border border-line-soft bg-sub-100 p-3">
            <h2 className="text-title text-ink">{group.title}</h2>
            <p className="text-body text-ink-dim">{[group.factory_id, group.stage ? t(`forja.stage.${group.stage}` as MessageKey) : ""].filter(Boolean).join(" · ")}</p>
            <ul className="flex flex-col gap-2">
              {group.entries.map((entry) => {
                const age = ageParts(entry.since);
                return (
                  <li key={entry.id} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TONE[entry.type]}>{t(`forja.inbox.type.${entry.type}` as MessageKey)}</Badge>
                      {age && <span className="text-body text-ink-dim">{age.n == null ? t(age.key) : t(age.key, { n: number(age.n) })}</span>}
                    </div>
                    {entry.summary && <p className="text-body text-ink-dim">{entry.summary}</p>}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => onOpen(entry.work_item_id)}>{t("forja.inbox.open")}</Button>
                      {entry.resolved ? (
                        <Button size="sm" variant="ghost" onClick={() => void change(() => forjaApi.undoEntry(entry.id))}>{t("forja.inbox.undo")}</Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => void change(() => forjaApi.resolveEntry(entry.id), entry.id)}>{t("forja.inbox.resolve")}</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function matches(entry: InboxEntry, filter: Filter, period: Period, query: string, now: number): boolean {
  if (filter === "done" && !entry.resolved) return false;
  if (filter === "active" && (entry.resolved || entry.type === "blocked" || entry.type === "failed")) return false;
  if (filter === "blocked" && entry.type !== "blocked") return false;
  if (filter === "failed" && entry.type !== "failed") return false;
  const then = Date.parse(entry.since);
  if (period !== "all" && !Number.isNaN(then)) {
    const horizon = period === "today" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    if (now - then > horizon) return false;
  }
  const haystack = `${entry.title} ${entry.summary}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}
