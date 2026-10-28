"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui";
import { turnDiffApi } from "@/lib/turnDiffApi";
import type { TurnDiff } from "./types";

const REFUSED: Record<string, string> = {
  changed_since: "This file changed after the turn, so it was left as it is.",
  already_reverted: "Already reverted.",
  symlink_refused: "A link on the path blocks the revert, so nothing was changed.",
  not_revertible: "The earlier content was not kept, so it cannot be restored.",
  not_found: "This change is no longer recorded.",
};

type FileState = { phase: "idle" | "busy" | "reverted"; error?: string };

/** What a turn changed in the workspace, with a revert for each file on its own. */
export function TurnDiffPanel({ runId, turnDiff }: { runId: string | null; turnDiff: TurnDiff }) {
  const uid = useId();
  const [state, setState] = useState<Record<string, FileState>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const revert = async (path: string) => {
    if (!runId) return;
    setState((s) => ({ ...s, [path]: { phase: "busy" } }));
    const result = await turnDiffApi.revert(runId, path);
    setState((s) => ({
      ...s,
      [path]: result.ok
        ? { phase: "reverted" }
        : { phase: result.code === "already_reverted" ? "reverted" : "idle", error: REFUSED[result.code] ?? "The revert did not go through." },
    }));
  };

  return (
    <section aria-label="Files this turn changed" className="grid grid-cols-[24px_minmax(0,1fr)] pb-2">
      <div />
      <div className="min-w-0 rounded-control border border-line-soft bg-sub-100 px-2.5 py-2">
        <h3 className="t-label text-ink-dim">Files this turn changed</h3>
        {!turnDiff.complete && (
          <p className="mt-1 text-meta text-warn-text">This workspace is too large to track completely, so the list may be missing files.</p>
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
                  <span className="t-meta text-ink-mute">{file.status}</span>
                  {!file.binary && <span className="t-meta text-ink-mute">{`+${file.added} −${file.removed}`}</span>}
                  {file.diff && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      aria-label={`${expanded ? "Hide" : "Show"} diff for ${file.path}`}
                      onClick={() => setOpen((o) => ({ ...o, [file.path]: !expanded }))}
                    >
                      {expanded ? "Hide diff" : "Diff"}
                    </Button>
                  )}
                  {st.phase === "reverted" ? (
                    <span className="t-meta text-ink-mute">reverted</span>
                  ) : file.revertible ? (
                    <Button size="sm" disabled={st.phase === "busy" || !runId} aria-label={`Revert ${file.path}`} onClick={() => void revert(file.path)}>
                      Revert
                    </Button>
                  ) : null}
                </div>
                {file.binary && <p className="t-meta text-ink-mute">{file.revertible ? "binary — no diff" : "binary — no diff, cannot be reverted"}</p>}
                {!file.binary && !file.revertible && st.phase !== "reverted" && (
                  <p className="t-meta text-ink-mute">earlier content not kept — cannot be reverted</p>
                )}
                {st.error && <p role="alert" className="t-meta text-fault-text">{st.error}</p>}
                {expanded && (
                  <pre id={panelId} className="mt-1 whitespace-pre-wrap break-words rounded-control bg-sub-200 p-2 text-meta text-ink-dim">
                    {file.diff}
                    {file.diff_truncated ? "\n… diff truncated" : ""}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
        {turnDiff.omitted > 0 && <p className="mt-1 text-meta text-ink-mute">{`and ${turnDiff.omitted} more files`}</p>}
      </div>
    </section>
  );
}
