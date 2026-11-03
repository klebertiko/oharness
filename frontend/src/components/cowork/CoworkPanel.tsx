"use client";

import { Button } from "@/components/ui/Button";
import { useCallback, useEffect, useState } from "react";
import { FolderPlus, Trash2 } from "lucide-react";

import { tr, useT } from "@/i18n/store";
import { Panel } from "@/components/shell/Panel";
import { coworkApi, type CoworkProject } from "@/lib/coworkApi";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

/**
 * Cowork workspaces — folder path, instructions, memory, per-project harness.
 * Session harness is the create default; each project can override.
 */
export function CoworkPanel() {
  const t = useT();
  const sessionEnabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundleId = useHarnessSessionStore((s) => s.activeBundle?.manifest.id ?? null);

  const [projects, setProjects] = useState<CoworkProject[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [instructions, setInstructions] = useState("");
  const [harnessOverride, setHarnessOverride] = useState(sessionEnabled);

  const refresh = useCallback(async () => {
    const data = await coworkApi.list();
    setProjects(data.projects);
  }, []);

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  useEffect(() => {
    setHarnessOverride(sessionEnabled);
  }, [sessionEnabled]);

  const onCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await coworkApi.create({
        name: name.trim(),
        rootPath: rootPath.trim(),
        instructions: instructions.trim(),
        memoryJson: {},
        harnessBundleId: activeBundleId,
        harnessEnabled: harnessOverride,
      });
      setName("");
      setRootPath("");
      setInstructions("");
      await refresh();
    } catch (err) {
      setError((err as Error).message || tr("cowork.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onToggleHarness = async (project: CoworkProject) => {
    setBusy(true);
    setError("");
    try {
      await coworkApi.update(project.id, { harnessEnabled: !project.harnessEnabled });
      await refresh();
    } catch (err) {
      setError((err as Error).message || tr("cowork.updateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await coworkApi.remove(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message || tr("cowork.deleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t("cowork.title")} meta={`${projects.length}`} className="h-full">
      <div className="border-b border-line-soft p-2.5">
        <p className="t-meta mb-2 text-ink-mute">
          {activeBundleId
            ? t("cowork.sessionBundle", { state: sessionEnabled ? t("cowork.on") : t("cowork.off"), id: activeBundleId })
            : t("cowork.session", { state: sessionEnabled ? t("cowork.on") : t("cowork.off") })}
        </p>
        <div className="flex flex-col gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("cowork.name")}
            className="h-control-md rounded-control border border-line-strong bg-sub-200 px-2 text-body text-ink placeholder:text-ink-mute focus-visible:border-signal"
          />
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder={t("cowork.path")}
            className="h-control-md rounded-control border border-line-strong bg-sub-200 px-2 text-body text-ink placeholder:text-ink-mute focus-visible:border-signal"
          />
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder={t("cowork.instructions")}
            className="resize-none rounded-control border border-line-strong bg-sub-200 px-2 py-1.5 text-body text-ink placeholder:text-ink-mute focus-visible:border-signal"
          />
          <label className="flex items-center gap-1.5 text-meta text-ink-mute">
            <input
              type="checkbox"
              checked={harnessOverride}
              onChange={(e) => setHarnessOverride(e.target.checked)}
              className="accent-(--signal)"
            />
            {t("cowork.harnessEnabled")}
          </label>
          <Button variant="primary" disabled={busy || !name.trim()} loading={busy} onClick={() => void onCreate()} icon={<FolderPlus size={12} strokeWidth={1.8} aria-hidden />}>
            {t("cowork.create")}
          </Button>
        </div>
      </div>

      {error && (
        <p className="t-body border-b border-line-soft px-3 py-2 text-fault-text" role="alert">
          {error}
        </p>
      )}

      <ul className="divide-y divide-line-soft">
        {projects.length === 0 && (
          <li className="t-body px-3 py-3 text-ink-mute">{t("cowork.empty")}</li>
        )}
        {projects.map((p) => (
          <li key={p.id} className="flex items-start gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-ink">{p.name}</div>
              <div className="t-meta truncate text-ink-mute" title={p.rootPath}>
                {p.rootPath || t("cowork.noPath")}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onToggleHarness(p)}
                className="mt-1 text-meta text-ink-mute underline-offset-2 hover:text-ink hover:underline"
              >
                {t("cowork.harnessToggle", { state: p.harnessEnabled ? t("cowork.on") : t("cowork.off") })}
              </button>
            </div>
            <button
              type="button"
              disabled={busy}
              title={t("cowork.delete")}
              onClick={() => void onDelete(p.id)}
              className="grid h-5.5 w-5.5 flex-none place-items-center rounded-control text-ink-mute hover:bg-sub-200 hover:text-ink"
            >
              <Trash2 size={12} strokeWidth={1.8} />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
