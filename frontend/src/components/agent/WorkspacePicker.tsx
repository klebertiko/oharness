"use client";

import { useEffect, useMemo, useState } from "react";
import { Folder, FolderPlus } from "lucide-react";

import { ComboAction, Combobox, type ComboOption } from "@/components/ui/Combobox";

import { chosenWorkspace, useWorkspaceStore } from "@/store/workspaceStore";
import { useT } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { nativeDialogAvailable, pickFolder } from "@/lib/nativeDialog";

/**
 * The composer chip for "where this chat works" — a Cowork project's
 * `rootPath`, threaded through to `POST /execute/` as `cwd` so a CLI-backed
 * adapter's `resolve_cwd()` actually receives one instead of always falling
 * back to the app-owned scratch directory (confirmed live, 2026-09-12: no
 * caller populated `extra["cwd"]` anywhere in the request path — every run
 * operated outside the person's real project regardless of what Cowork
 * already let them configure). Reuses the existing Cowork project concept
 * rather than inventing a parallel "workspace" entity; "No folder" is a
 * first-class, honestly-labelled option, not an error state.
 *
 * "Add folder…" is the only way to register a project today — there is no
 * Cowork-project screen wired into the shell (`CoworkPanel.tsx` exists but
 * is not mounted by any route/section), so this picker has to be able to
 * create one itself rather than just choosing among ones that already
 * exist. It opens the OS's own folder dialog (desktop shell only — the
 * browser dev preview has no native picker to open, and says so rather than
 * silently doing nothing).
 */
export function WorkspacePicker() {
  const t = useT();
  const projects = useWorkspaceStore((s) => s.projects);
  const chosenId = useWorkspaceStore((s) => s.chosenProjectId);
  const setChosen = useWorkspaceStore((s) => s.setChosen);
  const hydrate = useWorkspaceStore((s) => s.hydrate);
  const addProject = useWorkspaceStore((s) => s.addProject);
  const chosen = useWorkspaceStore(chosenWorkspace);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<MessageKey | null>(null);

  /** "" is "No folder" — a project id is never empty. */
  const options = useMemo<ComboOption[]>(
    () => [
      { id: "", label: t("chat.workspace.none"), detail: t("chat.workspace.noneDetail") },
      ...projects.map((p) => ({ id: p.id, label: p.name, detail: p.rootPath || t("chat.workspace.noPath") })),
    ],
    [projects, t],
  );

  const onAddFolder = async (close: (refocus?: boolean) => void) => {
    setNotice(null);
    if (!nativeDialogAvailable()) {
      setNotice("chat.workspace.desktopOnly");
      return;
    }
    const path = await pickFolder();
    if (!path) return; // cancelled in the OS dialog — stay open, nothing to report
    setAdding(true);
    const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
    const id = await addProject({ name, rootPath: path });
    setAdding(false);
    if (id) {
      close();
    } else {
      setNotice("chat.workspace.addFailed");
    }
  };

  const label = chosen ? chosen.name : t("chat.workspace.none");

  return (
    <Combobox
      label={t("chat.workspace.label")}
      triggerLabel={t("chat.workspace.trigger", { name: label })}
      value={chosenId ?? ""}
      options={options}
      onChange={(id) => setChosen(id || null)}
      onOpenChange={(open) => open && setNotice(null)}
      width={280}
      triggerClassName="h-control-md max-w-[180px] px-2 text-body font-medium text-ink-mute hover:text-ink max-sm:h-control-lg"
      trigger={
        <>
          <Folder size={13} strokeWidth={1.8} className="flex-none" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
        </>
      }
      footer={({ close }) => (
        <>
          <ComboAction onClick={() => void onAddFolder(close)} disabled={adding}>
            <FolderPlus size={13} strokeWidth={1.8} className="flex-none" aria-hidden />
            {adding ? t("chat.workspace.adding") : t("chat.workspace.add")}
          </ComboAction>
          {notice && (
            <p role="status" className="px-2 pb-1 text-meta text-ink-mute">
              {t(notice)}
            </p>
          )}
        </>
      )}
    />
  );
}
