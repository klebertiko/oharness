"use client";

import { useState } from "react";
import { Button, Input, Panel, Segmented } from "@/components/ui";
import { useT } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import type { SourceKind, SourceRef } from "@/store/pluginsTypes";
import { Isolation } from "./Isolation";
import { logLine, sourceText } from "./text";

const KINDS: SourceKind[] = ["npm", "github", "tarball", "local"];

/** Add a package: inspect it, decide each package's scripts, then install or hand it to creator mode. */
export function AddFlow({ onProposed }: { onProposed?: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<SourceKind>("npm");
  const [spec, setSpec] = useState("");
  const [version, setVersion] = useState("");
  const [commit, setCommit] = useState("");
  const [subdir, setSubdir] = useState("");
  const phase = usePluginsStore((s) => s.phase);
  const pending = usePluginsStore((s) => s.pending);
  const decisions = usePluginsStore((s) => s.decisions);
  const activateNow = usePluginsStore((s) => s.activateNow);
  const log = usePluginsStore((s) => s.log);
  const sessionMode = usePluginsStore((s) => s.sessionMode);
  const inspect = usePluginsStore((s) => s.inspect);
  const cancelDownload = usePluginsStore((s) => s.cancelDownload);
  const decide = usePluginsStore((s) => s.decide);
  const installPending = usePluginsStore((s) => s.installPending);
  const setActivateNow = usePluginsStore((s) => s.setActivateNow);

  const source = (): SourceRef | null => {
    const value = spec.trim();
    if (kind === "npm") {
      if (!value || !version.trim()) return null;
      return { kind, spec: value, version: version.trim() };
    }
    if (kind === "github") {
      if (!value || !commit.trim()) return null;
      return { kind, spec: value, commit: commit.trim(), subdir: subdir.trim() || null };
    }
    if (!value) return null;
    return { kind, spec: value };
  };

  const undecided = pending.some((pkg) => pkg.scripts.length > 0 && decisions[pkg.fetchId] !== "approve" && decisions[pkg.fetchId] !== "reject");
  const accepted = pending.filter((pkg) => decisions[pkg.fetchId] !== "reject");
  const busy = phase === "downloading" || phase === "installing";
  const canInstall = pending.length > 0 && !undecided && accepted.length > 0 && !busy;
  const ready = source();

  const submit = () => {
    const next = source();
    if (!next || busy) return;
    void inspect(next);
  };

  const install = async () => {
    await installPending();
    if (usePluginsStore.getState().sessionMode === "creator" && usePluginsStore.getState().actions.some((action) => action.status === "pending")) onProposed?.();
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Panel variant="inset" title={t("plugins.add.heading")} titleId="plugins-add" level={2} bodyClassName="flex flex-col gap-3 p-3">
        <Segmented
          label={t("plugins.add.kind")}
          value={kind}
          onChange={setKind}
          options={KINDS.map((value) => ({
            value,
            label: t(value === "npm" ? "plugins.add.kind.npm" : value === "github" ? "plugins.add.kind.git" : value === "tarball" ? "plugins.add.kind.tarball" : "plugins.add.kind.local"),
          }))}
        />
        {kind === "npm" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t("plugins.add.name")} value={spec} onChange={(e) => setSpec(e.target.value)} mono autoComplete="off" />
            <Input label={t("plugins.add.version")} value={version} onChange={(e) => setVersion(e.target.value)} mono autoComplete="off" />
          </div>
        )}
        {kind === "github" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t("plugins.add.repo")} value={spec} onChange={(e) => setSpec(e.target.value)} mono autoComplete="off" />
            <Input label={t("plugins.add.commit")} value={commit} onChange={(e) => setCommit(e.target.value)} mono autoComplete="off" />
            <Input label={t("plugins.add.subdir")} value={subdir} onChange={(e) => setSubdir(e.target.value)} mono autoComplete="off" className="sm:col-span-2" />
          </div>
        )}
        {kind === "tarball" && <Input label={t("plugins.add.archive")} value={spec} onChange={(e) => setSpec(e.target.value)} mono autoComplete="off" />}
        {kind === "local" && <Input label={t("plugins.add.path")} value={spec} onChange={(e) => setSpec(e.target.value)} mono autoComplete="off" />}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={pending.length ? "secondary" : "primary"} disabled={!ready || busy} loading={phase === "downloading"} onClick={submit}>
            {phase === "downloading" ? t("plugins.add.inspecting") : t("plugins.add.submit")}
          </Button>
          {phase === "downloading" && (
            <Button variant="secondary" onClick={() => cancelDownload()}>
              {t("plugins.add.cancel")}
            </Button>
          )}
        </div>
      </Panel>

      {pending.map((pkg) => {
        const decision = decisions[pkg.fetchId];
        return (
          <Panel key={pkg.fetchId} variant="panel" title={t("plugins.preview.heading")} titleId={`preview-${pkg.fetchId}`} level={2} bodyClassName="flex flex-col gap-3 p-3">
            <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-body">
              <dt className="text-ink-mute">{t("plugins.preview.name")}</dt>
              <dd className="truncate font-medium text-ink">{pkg.name}</dd>
              <dt className="text-ink-mute">{t("plugins.preview.version")}</dt>
              <dd className="font-mono text-code text-ink">{pkg.version}</dd>
              <dt className="text-ink-mute">{t("plugins.preview.source")}</dt>
              <dd className="truncate font-mono text-code text-ink">{sourceText(t, pkg.source)}</dd>
            </dl>
            <Isolation runtime={pkg.runtime} capabilities={pkg.capabilities} />
            {pkg.unmetDependencies.length > 0 && <p className="text-body text-ink-dim">{t("plugins.preview.unmet", { deps: pkg.unmetDependencies.join(", ") })}</p>}
            {pkg.scripts.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-body text-ink">{t("plugins.preview.scripts", { scripts: pkg.scripts.join(", ") })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant={decision === "approve" ? "primary" : "secondary"} aria-pressed={decision === "approve"} onClick={() => decide(pkg.fetchId, "approve")}>
                    {t("plugins.preview.approve")}
                  </Button>
                  <Button variant="danger" aria-pressed={decision === "reject"} onClick={() => decide(pkg.fetchId, "reject")}>
                    {t("plugins.preview.reject")}
                  </Button>
                </div>
                <p className="text-meta text-ink-mute">
                  {decision === "approve" ? t("plugins.preview.accepted") : decision === "reject" ? t("plugins.preview.rejected") : t("plugins.preview.undecided")}
                </p>
              </div>
            )}
          </Panel>
        );
      })}

      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" aria-pressed={activateNow} onClick={() => setActivateNow(!activateNow)}>
            {t("plugins.preview.activate")}
          </Button>
          <Button variant={canInstall ? "primary" : "secondary"} disabled={!canInstall} loading={phase === "installing"} onClick={() => void install()}>
            {phase === "installing" ? t("plugins.preview.installing") : t("plugins.preview.install")}
          </Button>
          {sessionMode === "creator" && <p className="text-meta text-ink-mute">{t("plugins.create.actionsEmpty")}</p>}
        </div>
      )}

      {(phase === "installing" || log.length > 0) && phase !== "idle" && (
        <section aria-label={t("plugins.preview.log")} className="min-w-0">
          <h3 className="t-title mb-1 text-ink">{t("plugins.preview.log")}</h3>
          <pre aria-live="polite" className="max-h-40 min-w-0 overflow-auto rounded-control border border-line-soft bg-sub-100 p-2 font-mono text-code text-ink-dim">
            {log.length ? log.map(logLine.bind(null, t)).join("\n") : t("plugins.preview.waiting")}
          </pre>
        </section>
      )}
    </div>
  );
}
