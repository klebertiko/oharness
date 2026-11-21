"use client";
import { Copy, Download, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, ConfirmInline, Notice, Panel, Skeleton } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { pluginsApi, PluginsError } from "./pluginsApi";
import { STATE_BADGE, STATE_KEY, usePresent } from "./present";
import type { PluginView } from "./types";

/** One plugin: what it is, what it can do, its logs and errors, how to share it, and Remove. */
export function PluginDetail({ plugin, canChange, onClose }: { plugin: PluginView; canChange: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { capabilityLabel, capabilityGrant, source, explain } = usePresent();
  const shareReason = (error: unknown) =>
    error instanceof PluginsError && error.code === "human_only" ? t("plugins.noCredential") : t("plugins.share.failed", { reason: error instanceof Error ? error.message : String(error) });
  const logs = usePluginsStore((s) => s.logs);
  const busy = usePluginsStore((s) => !!s.busy[plugin.id]);
  const loadLogs = usePluginsStore((s) => s.loadLogs);
  const remove = usePluginsStore((s) => s.remove);
  const [confirming, setConfirming] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    void loadLogs(plugin.id);
    setConfirming(false);
    setShareMessage(null);
    setShareError(null);
  }, [plugin.id, loadLogs]);

  const download = async () => {
    setShareError(null);
    try {
      const { filename, blob } = await pluginsApi.exportPackage(plugin.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setShareError(shareReason(error));
    }
  };

  const copy = async () => {
    if (!plugin.shareLink) return;
    setShareError(null);
    try {
      await navigator.clipboard.writeText(plugin.shareLink);
      setShareMessage(t("plugins.share.copied"));
    } catch (error) {
      setShareError(shareReason(error));
    }
  };

  const mine = logs.id === plugin.id;
  return (
    <Panel
      title={t("plugins.detail.title", { name: plugin.name })}
      titleId="plugins-detail-title"
      actions={<Button size="sm" variant="ghost" iconOnly aria-label={t("plugins.detail.close")} icon={<X size={14} aria-hidden />} onClick={onClose} />}
    >
      <div className="flex flex-col gap-4 p-3">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-body">
          <dt className="text-ink-mute">{t("plugins.detail.version")}</dt>
          <dd className="font-mono text-code text-ink">{plugin.version}</dd>
          <dt className="text-ink-mute">{t("plugins.detail.source")}</dt>
          <dd className="min-w-0 break-all font-mono text-code text-ink">{source(plugin.source)}</dd>
          <dt className="text-ink-mute">{t("plugins.detail.runtime")}</dt>
          <dd className="text-ink">{plugin.runtime === "in-process" ? t("plugins.runtime.in-process") : t("plugins.runtime.isolated")}</dd>
          <dt className="text-ink-mute">{t("plugins.detail.state")}</dt>
          <dd>
            <Badge tone={STATE_BADGE[plugin.state]}>{t(STATE_KEY[plugin.state])}</Badge>
          </dd>
        </dl>
        {plugin.state === "changed" && <Notice tone="warn">{t("plugins.state.changedHelp")}</Notice>}
        {plugin.message && plugin.state !== "changed" && <Notice tone={plugin.state === "failed" ? "fault" : "info"}>{plugin.message}</Notice>}

        <section aria-labelledby="plugins-caps" className="flex flex-col gap-1">
          <h3 id="plugins-caps" className="t-heading text-ink">
            {t("plugins.detail.capabilities")}
          </h3>
          {plugin.capabilities.length === 0 ? (
            <p className="text-body text-ink-mute">{t("plugins.capability.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-body text-ink-dim">
              {plugin.capabilities.map((c) => (
                <li key={c}>
                  <span className="font-medium text-ink">{capabilityLabel(c)}.</span> {capabilityGrant(c)}
                </li>
              ))}
            </ul>
          )}
          {plugin.scripts.length > 0 && <p className="text-body text-ink-mute">{t("plugins.detail.scripts", { list: plugin.scripts.join(", ") })}</p>}
        </section>

        <section aria-labelledby="plugins-logs" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 id="plugins-logs" className="t-heading flex-1 text-ink">
              {t("plugins.logs.title")}
            </h3>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={logs.loading} onClick={() => void loadLogs(plugin.id)}>
              {t("plugins.logs.refresh")}
            </Button>
          </div>
          {mine && logs.error && <Notice tone="fault">{logs.error.code === "human_only" ? explain(logs.error) : t("plugins.logs.failed", { reason: logs.error.message })}</Notice>}
          {!mine || (logs.loading && logs.lines.length === 0) ? (
            <Skeleton className="h-16 w-full" />
          ) : logs.lines.length === 0 && !logs.error ? (
            <p className="text-body text-ink-mute">{t("plugins.logs.empty")}</p>
          ) : (
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable log must be reachable by keyboard (axe scrollable-region-focusable)
            <div role="log" tabIndex={0} aria-label={t("plugins.logs.aria", { name: plugin.name })} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control border border-line-soft bg-sub-200 p-2 font-mono text-code text-ink-dim">
              {logs.lines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="plugins-share" className="flex flex-col gap-2">
          <h3 id="plugins-share" className="t-heading text-ink">
            {t("plugins.share.title")}
          </h3>
          <p className="text-body text-ink-mute">{t("plugins.share.help")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Download size={14} aria-hidden />} onClick={() => void download()}>
              {t("plugins.share.download")}
            </Button>
            {plugin.shareLink && (
              <Button size="sm" icon={<Copy size={14} aria-hidden />} onClick={() => void copy()}>
                {t("plugins.share.copy")}
              </Button>
            )}
          </div>
          {shareMessage && <p role="status" className="text-body text-ink-dim">{shareMessage}</p>}
          {shareError && <Notice tone="fault">{shareError}</Notice>}
        </section>

        <div className="border-t border-line-soft pt-3">
          {confirming ? (
            <ConfirmInline
              prompt={t("plugins.remove.confirm", { name: plugin.name })}
              confirmLabel={t("plugins.remove.yes")}
              busy={busy}
              onCancel={() => setConfirming(false)}
              onConfirm={() => void remove(plugin.id)}
            />
          ) : (
            <Button variant="danger" size="sm" disabled={!canChange} onClick={() => setConfirming(true)}>
              {t("plugins.remove")}
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
