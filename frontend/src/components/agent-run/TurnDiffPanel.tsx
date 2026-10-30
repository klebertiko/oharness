"use client";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { turnDiffApi } from "@/lib/turnDiffApi";
import type { TurnDiff } from "./types";

const REFUSED: Record<string, MessageKey> = {
  changed_since: "diff.err.changedSince",
  already_reverted: "diff.err.already",
  symlink_refused: "diff.err.symlink",
  not_revertible: "diff.err.notRevertible",
  not_found: "diff.err.notFound",
  workspace_gone: "diff.err.gone",
};

type FileState = { phase: "idle" | "busy" | "reverted"; error?: string };

/** What a turn changed in the workspace, with a revert for each file on its own. */
export function TurnDiffPanel({ runId, turnDiff }: { runId: string | null; turnDiff: TurnDiff }) {
  const uid = useId();
  const t = useT();
  const [state, setState] = useState<Record<string, FileState>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // A run reopened from history: files already reverted say so instead of offering Revert again.
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    void turnDiffApi.state(runId).then((reverted) => {
      if (!alive || !reverted) return;
      setState((s) => {
        const next = { ...s };
        for (const [path, done] of Object.entries(reverted)) if (done && !next[path]) next[path] = { phase: "reverted" };
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [runId]);

  const revert = async (path: string) => {
    if (!runId) return;
    setState((s) => ({ ...s, [path]: { phase: "busy" } }));
    const result = await turnDiffApi.revert(runId, path);
    setState((s) => ({
      ...s,
      [path]: result.ok
        ? { phase: "reverted" }
        : { phase: result.code === "already_reverted" ? "reverted" : "idle", error: t(REFUSED[result.code] ?? "diff.err.generic") },
    }));
  };

  return (
    <section aria-label={t("diff.title")} className="grid grid-cols-[24px_minmax(0,1fr)] pb-2">
      <div />
      <div className="min-w-0 rounded-control border border-line-soft bg-sub-100 px-2.5 py-2">
        <p className="t-label text-ink-dim">{t("diff.title")}</p>
        {!turnDiff.complete && (
          <p className="mt-1 text-meta text-warn-text">{t("diff.incomplete")}</p>
        )}
        <ul className="mt-1 flex flex-col gap-1.5">
          {turnDiff.files.map((file, i) => {
            const st = state[file.path] ?? { phase: "idle" };
            const panelId = `${uid}-${i}`;
            const expanded = Boolean(open[file.path]);
            return (
              <li key={file.path} className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{file.path}</span>
                  <span className="t-meta text-ink-mute">{t(`diff.status.${file.status}` as MessageKey)}</span>
                  {!file.binary && <span className="t-meta text-ink-mute">{`+${file.added} −${file.removed}`}</span>}
                  {file.diff && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      aria-label={t(expanded ? "diff.hideAria" : "diff.showAria", { path: file.path })}
                      onClick={() => setOpen((o) => ({ ...o, [file.path]: !expanded }))}
                    >
                      {t(expanded ? "diff.hide" : "diff.show")}
                    </Button>
                  )}
                  {st.phase === "reverted" ? (
                    <span className="t-meta text-ink-mute">{t("diff.reverted")}</span>
                  ) : file.revertible ? (
                    <Button size="sm" disabled={st.phase === "busy" || !runId} aria-label={t("diff.revertAria", { path: file.path })} onClick={() => void revert(file.path)}>
                      {t("diff.revert")}
                    </Button>
                  ) : null}
                </div>
                {file.binary && <p className="t-meta text-ink-mute">{t(file.revertible ? "diff.binaryRevertible" : "diff.binaryFixed")}</p>}
                {!file.binary && !file.revertible && st.phase !== "reverted" && (
                  <p className="t-meta text-ink-mute">{t("diff.notKept")}</p>
                )}
                {st.error && <p role="alert" className="t-meta text-fault-text">{st.error}</p>}
                {expanded && (
                  <pre id={panelId} className="mt-1 whitespace-pre-wrap break-words rounded-control bg-sub-200 p-2 text-meta text-ink-dim">
                    {file.diff}
                    {file.diff_truncated ? `\n${t("diff.truncated")}` : ""}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
        {turnDiff.omitted > 0 && <p className="mt-1 text-meta text-ink-mute">{t("diff.more", { n: turnDiff.omitted })}</p>}
      </div>
    </section>
  );
}
