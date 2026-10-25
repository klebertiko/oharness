"use client";

import { Button } from "@/components/ui/Button";
import { useCallback, useEffect, useState } from "react";
import { FolderPlus, Trash2 } from "lucide-react";

import { Panel } from "@/components/shell/Panel";
import { coworkApi, type CoworkProject } from "@/lib/coworkApi";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

/**
 * Cowork workspaces — folder path, instructions, memory, per-project harness.
 * Session harness is the create default; each project can override.
 */
export function CoworkPanel() {
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
      setError((err as Error).message || "Create failed");
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
      setError((err as Error).message || "Update failed");
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
      setError((err as Error).message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Cowork" meta={`${projects.length}`} className="h-full">
      <div className="border-b border-line-soft p-2.5">
        <p className="t-meta mb-2 text-ink-mute">
          Session harness: {sessionEnabled ? "on" : "off"}
          {activeBundleId ? ` · ${activeBundleId}` : ""}
        </p>
        <div className="flex flex-col gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="h-control-md rounded-control border border-line-strong bg-sub-200 px-2 text-body text-ink placeholder:text-ink-mute focus-visible:border-signal"
          />
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="Folder path (e.g. D:/workspaces/research)"
            className="h-control-md rounded-control border border-line-strong bg-sub-200 px-2 text-body text-ink placeholder:text-ink-mute focus-visible:border-signal"
          />
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder="Standing instructions…"
            className="resize-none rounded-control border border-line-strong bg-sub-200 px-2 py-1.5 text-body text-ink placeholder:text-ink-mute focus-visible:border-signal"
          />
          <label className="flex items-center gap-1.5 text-meta text-ink-mute">
            <input
              type="checkbox"
              checked={harnessOverride}
              onChange={(e) => setHarnessOverride(e.target.checked)}
              className="accent-(--signal)"
            />
            Harness enabled for this project
          </label>
          <Button variant="primary" disabled={busy || !name.trim()} loading={busy} onClick={() => void onCreate()} icon={<FolderPlus size={12} strokeWidth={1.8} aria-hidden />}>
            Create project
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
          <li className="t-body px-3 py-3 text-ink-mute">No cowork projects yet.</li>
        )}
        {projects.map((p) => (
          <li key={p.id} className="flex items-start gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-ink">{p.name}</div>
              <div className="t-meta truncate text-ink-mute" title={p.rootPath}>
                {p.rootPath || "(no path)"}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onToggleHarness(p)}
                className="mt-1 text-meta text-ink-mute underline-offset-2 hover:text-ink hover:underline"
              >
                Harness {p.harnessEnabled ? "on" : "off"} (override)
              </button>
            </div>
            <button
              type="button"
              disabled={busy}
              title="Delete project"
              onClick={() => void onDelete(p.id)}
              className="grid h-[22px] w-[22px] flex-none place-items-center rounded-control text-ink-mute hover:bg-sub-200 hover:text-ink"
            >
              <Trash2 size={12} strokeWidth={1.8} />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
