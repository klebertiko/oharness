"use client";
import { ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, Input, Notice, SkeletonRows } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { usePresent } from "./present";
import type { FetchRequest, IndexPlugin } from "./types";

/** The add-flow request for the newest version of an index entry: npm by exact version, a tarball with its hash, or GitHub at the full commit. */
export function sourceOf(plugin: IndexPlugin): FetchRequest {
  const { version, source } = plugin.versions[0];
  if (source.type === "npm") return { kind: "npm", spec: plugin.name, version };
  if (source.type === "tarball") return { kind: "tarball", spec: source.url, integrity: source.integrity };
  return { kind: "github", spec: source.repo, commit: source.commit, ...(source.path ? { subdir: source.path } : {}) };
}

/**
 * Descobrir: a static plugin index (format 1) from an https address the person gives. The sidecar fetches and checks it; this only shows its
 * text (never as HTML) under a fixed trust notice that stays at the top and cannot be collapsed. Inspect starts the usual add flow with the entry's
 * source, so the same review and the same confirmation come first; nothing is installed from here.
 */
export function DiscoverTab({ canChange, onInspect }: { canChange: boolean; onInspect: (request: FetchRequest) => void }) {
  const { t } = useI18n();
  const { explain } = usePresent();
  const discover = usePluginsStore((s) => s.discover);
  const loadIndex = usePluginsStore((s) => s.loadIndex);
  const [url, setUrl] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadIndex(url);
  };
  const invalid = discover.error?.code === "invalid_url";
  return (
    <div className="flex flex-col gap-3">
      <div data-discover-notice className="sticky top-0 z-10 -mx-1 bg-sub-000 px-1 pb-1">
        <Notice tone="warn">{t("plugins.discover.trust")}</Notice>
      </div>
      <p className="text-body text-ink-dim">{t("plugins.discover.intro")}</p>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <Input mono type="url" label={t("plugins.discover.url")} value={url} onChange={(e) => setUrl(e.target.value)} error={invalid ? t("plugins.discover.invalidUrl") : undefined} autoComplete="off" spellCheck={false} />
        </div>
        <Button type="submit" disabled={!canChange} loading={discover.phase === "loading"}>
          {t("plugins.discover.load")}
        </Button>
      </form>
      {discover.phase === "loading" && <SkeletonRows rows={2} label={t("plugins.discover.loading")} />}
      {discover.phase === "error" && discover.error && !invalid && (
        <Notice tone="fault" title={t("plugins.discover.failed")}>
          {explain(discover.error)}
        </Notice>
      )}
      {discover.phase === "ready" && discover.index && (
        <>
          {discover.index.skipped > 0 && <p className="text-meta text-ink-mute">{t("plugins.discover.skipped", { count: String(discover.index.skipped) })}</p>}
          {discover.index.plugins.length === 0 ? (
            <EmptyState title={t("plugins.discover.empty")} />
          ) : (
            <ul aria-label={t("plugins.discover.listLabel")} className="flex flex-col gap-2">
              {discover.index.plugins.map((plugin) => (
                <li key={plugin.name} className="flex flex-col gap-1 rounded-panel border border-line-soft bg-sub-100 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="t-heading min-w-0 break-words text-ink">{plugin.title || plugin.name}</span>
                    <span className="min-w-0 break-all font-mono text-meta text-ink-mute">
                      {plugin.name} {plugin.versions[0].version}
                    </span>
                    <span className="flex-1" />
                    <Button size="sm" variant="primary" icon={<Search size={14} aria-hidden />} disabled={!canChange} aria-label={t("plugins.discover.inspectNamed", { name: plugin.name })} onClick={() => onInspect(sourceOf(plugin))}>
                      {t("plugins.discover.inspect")}
                    </Button>
                  </div>
                  {plugin.description && <p className="break-words text-body text-ink-dim">{plugin.description}</p>}
                  <p className="flex flex-wrap items-center gap-2 text-meta text-ink-mute">
                    {plugin.author && <span>{t("plugins.discover.by", { author: plugin.author })}</span>}
                    {plugin.repository && (
                      <a href={plugin.repository} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-signal-text underline-offset-2 hover:underline">
                        <ExternalLink size={12} aria-hidden />
                        <span className="break-all">{plugin.repository}</span>
                      </a>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
