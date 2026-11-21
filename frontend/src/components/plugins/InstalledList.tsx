"use client";

import { useState } from "react";
import { Button, ConfirmInline, EmptyState, ListRow, StatusMark } from "@/components/ui";
import { useT } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import type { PluginView } from "@/store/pluginsTypes";
import { Isolation } from "./Isolation";
import { logLine, sourceText, stateLabel } from "./text";

function tone(state: string): "ok" | "warn" | "fault" | "idle" | "off" {
  if (state === "active") return "ok";
  if (state === "changed" || state === "unavailable") return "warn";
  if (state === "failed") return "fault";
  if (state === "disabled") return "off";
  return "idle";
}

/** Installed plugins, each with its isolation and its own export. */
export function InstalledList() {
  const t = useT();
  const installed = usePluginsStore((s) => s.installed);
  const rowLogs = usePluginsStore((s) => s.rowLogs);
  const setEnabled = usePluginsStore((s) => s.setEnabled);
  const remove = usePluginsStore((s) => s.remove);
  const sharePlugin = usePluginsStore((s) => s.sharePlugin);
  const loadLogs = usePluginsStore((s) => s.loadLogs);
  const [removing, setRemoving] = useState<string | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  if (!installed.length) {
    return (
      <EmptyState title={t("plugins.installed.emptyTitle")}>{t("plugins.installed.emptyBody")}</EmptyState>
    );
  }

  const share = (plugin: PluginView, target: "npm" | "git") => {
    setSharing(plugin.id);
    void sharePlugin(plugin.id, target).finally(() => setSharing(null));
  };

  return (
    <ul className="flex min-w-0 flex-col gap-2">
      {installed.map((plugin) => (
        <li key={plugin.id} className="min-w-0 rounded-panel border border-line-soft bg-sub-100">
          <ListRow
            title={plugin.name}
            meta={plugin.version}
            description={`${stateLabel(t, plugin.state)} · ${sourceText(t, plugin.source)}`}
            leading={<StatusMark tone={tone(plugin.state)} />}
            selected={false}
          />
          <div className="flex flex-col gap-3 px-3 pb-3">
            <Isolation runtime={plugin.runtime} capabilities={plugin.capabilities} />
            {removing === plugin.id ? (
              <ConfirmInline
                prompt={t("plugins.remove.prompt", { name: plugin.name })}
                confirmLabel={t("plugins.remove.confirm")}
                onCancel={() => setRemoving(null)}
                onConfirm={() => {
                  setRemoving(null);
                  void remove(plugin.id);
                }}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {plugin.enabled ? (
                  <Button size="sm" variant="secondary" onClick={() => void setEnabled(plugin.id, false)}>{t("plugins.row.disable")}</Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => void setEnabled(plugin.id, true)}>{t("plugins.row.activate")}</Button>
                )}
                <Button size="sm" variant="secondary" aria-expanded={exporting === plugin.id} onClick={() => setExporting(exporting === plugin.id ? null : plugin.id)}>
                  {t("plugins.row.export")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (openLog === plugin.id) {
                      setOpenLog(null);
                      return;
                    }
                    setOpenLog(plugin.id);
                    void loadLogs(plugin.id);
                  }}
                >
                  {openLog === plugin.id ? t("plugins.row.hideLogs") : t("plugins.row.logs")}
                </Button>
                <Button size="sm" variant="danger" onClick={() => setRemoving(plugin.id)}>{t("plugins.row.remove")}</Button>
              </div>
            )}
            {exporting === plugin.id && removing !== plugin.id && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={sharing === plugin.id} onClick={() => share(plugin, "npm")}>{t("plugins.share.npm")}</Button>
                <Button size="sm" variant="secondary" onClick={() => share(plugin, "git")}>{t("plugins.share.git")}</Button>
              </div>
            )}
            {openLog === plugin.id && (
              <pre className="max-h-40 min-w-0 overflow-auto font-mono text-code text-ink-dim">{(rowLogs[plugin.id] ?? []).map((line) => logLine(t, line)).join("\n")}</pre>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
