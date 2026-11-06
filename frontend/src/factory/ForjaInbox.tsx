"use client";
import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, Notice, SkeletonRows } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { forjaApi, type InboxEntry } from "./forjaApi";
import { OfflineNotice } from "./Offline";
import { useExplain, useLoad } from "./useForja";

const TONE: Record<InboxEntry["type"], "neutral" | "warn" | "fault"> = {
  question: "warn",
  question_answered: "neutral",
  spec_review: "warn",
  handoff_ready: "warn",
  blocked: "fault",
  failed: "fault",
};

/** What waits for a person, newest first. An entry leaves by itself when it stops being true; "Mark done" hides it by hand and can be undone. */
export function ForjaInbox({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, plural } = useI18n();
  const explain = useExplain();
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { result, reload } = useLoad(() => forjaApi.inbox(showResolved));
  useEffect(() => {
    reload();
  }, [showResolved, reload]);
  if (result.state === "offline") return <OfflineNotice onRetry={reload} />;
  if (result.state === "loading") return <SkeletonRows />;
  const { entries, count } = result.data;

  const change = async (run: () => Promise<void>) => {
    try {
      await run();
      setError(null);
      reload();
    } catch (e) {
      setError(explain(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <p role="status" className="text-title">
        {count === 0 ? t("forja.inbox.empty") : plural("forja.inbox.count", count)}
      </p>
      <label className="flex items-center gap-2 text-body text-ink-dim">
        <input
          type="checkbox"
          checked={showResolved}
          onChange={(e) => setShowResolved(e.target.checked)}
        />
        {t("forja.inbox.showResolved")}
      </label>
      {error && <Notice tone="warn">{error}</Notice>}
      {entries.length === 0 ? (
        <EmptyState title={t("forja.inbox.empty")}>{t("forja.inbox.emptyBody")}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-2 rounded-panel border border-line-soft bg-sub-100 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[entry.type]}>{t(`forja.inbox.type.${entry.type}` as MessageKey)}</Badge>
                <span className="text-title text-ink">{entry.title}</span>
              </div>
              {entry.summary && <p className="text-body text-ink-dim">{entry.summary}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onOpen(entry.work_item_id)}>
                  {t("forja.inbox.open")}
                </Button>
                {entry.resolved ? (
                  <Button size="sm" variant="ghost" onClick={() => void change(() => forjaApi.undoEntry(entry.id))}>
                    {t("forja.inbox.undo")}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => void change(() => forjaApi.resolveEntry(entry.id))}>
                    {t("forja.inbox.resolve")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
