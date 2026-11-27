"use client";
import { Plus, RefreshCw } from "lucide-react";
import { Button, Notice, StatusMark } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { HOST_KEY, HOST_MARK } from "./present";
import type { HostStatus } from "./types";

/** The state of the plugin host, how plugins are isolated (ADR 0071), and the two page actions. */
export function HostHeader({ status, canChange, onAdd, onRefresh, refreshing }: { status: HostStatus | null; canChange: boolean; onAdd: () => void; onRefresh: () => void; refreshing: boolean }) {
  const { t } = useI18n();
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="t-title flex-1 basis-40 text-ink">{t("plugins.screen")}</h1>
        {status && (
          <p className="flex items-center gap-2 text-body text-ink-dim">
            <StatusMark tone={HOST_MARK[status.state]} />
            <span className="sr-only">{t("plugins.host.label")}: </span>
            <span className="font-medium text-ink">{t(HOST_KEY[status.state])}</span>
            {status.node && <span className="font-mono text-meta text-ink-mute">{t("plugins.host.node", { version: status.node })}</span>}
          </p>
        )}
        <Button size="sm" variant="ghost" iconOnly aria-label={t("plugins.refresh")} loading={refreshing} icon={<RefreshCw size={14} aria-hidden />} onClick={onRefresh} />
        <Button size="sm" variant="primary" icon={<Plus size={14} aria-hidden />} disabled={!canChange} onClick={onAdd}>
          {t("plugins.add")}
        </Button>
      </div>
      {status && status.state !== "running" && status.state !== "starting" && status.reason && (
        <Notice tone={status.state === "failed" ? "fault" : "warn"}>
          {t("plugins.host.reason", { reason: status.reason })}
        </Notice>
      )}
      <p className="max-w-[70ch] text-body text-ink-mute">
        <span className="font-medium text-ink-dim">{t("plugins.isolation.title")}. </span>
        {t("plugins.isolation.body")}
      </p>
    </header>
  );
}
