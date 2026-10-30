"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/store";
import { subagentApi } from "@/lib/subagentApi";
import type { MessageKey } from "@/i18n/translate";
import type { RunStatus, Subagent } from "./types";

const STATE_COLOR: Record<Subagent["state"], string> = {
  running: "var(--signal-text)",
  done: "var(--ink-dim)",
  cancelled: "var(--ink-mute)",
  error: "var(--fault-text)",
};

/** The parent turn and the subagents it started, with live state and a cancel for each running child. */
export function SubagentTree({
  runId,
  runLive,
  status,
  subagents,
}: {
  runId: string | null;
  runLive: boolean;
  status: RunStatus;
  subagents: Subagent[];
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; reason: "finished" | "failed" } | null>(null);
  if (!subagents.length) return null;

  const cancel = async (child: Subagent) => {
    if (!runId) return;
    setBusy(child.id);
    setFailed(null);
    const result = await subagentApi.cancel(runId, child.id);
    setBusy(null);
    if (!result.ok) setFailed({ id: child.id, reason: result.reason ?? "failed" });
  };

  return (
    <section aria-label={t("subagents.title")} className="mb-2 rounded-control border border-line-soft bg-sub-100 px-2.5 py-2">
      <p className="t-label flex items-baseline gap-2 text-ink-dim">
        <span>Nilo</span>
        <span className="t-meta text-ink-mute">{status}</span>
      </p>
      <ul className="ml-2 mt-1 flex flex-col gap-1 border-l border-line-soft pl-3">
        {subagents.map((child) => (
          <li key={child.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-body text-ink">{child.task}</span>
            <span className="t-meta" style={{ color: STATE_COLOR[child.state] }} aria-live="polite">
              {t(`subagents.state.${child.state}` as MessageKey)}
            </span>
            {child.state === "running" && child.chars > 0 && <span className="t-meta text-ink-mute">{t("subagents.chars", { n: child.chars })}</span>}
            {child.state === "running" && runLive && (
              <Button size="sm" disabled={busy === child.id} aria-label={t("subagents.cancelAria", { task: child.task })} onClick={() => void cancel(child)}>
                {t("subagents.cancel")}
              </Button>
            )}
            {failed?.id === child.id && child.state === "running" && (
              <span role="alert" className="t-meta text-fault-text">
                {t(failed.reason === "finished" ? "subagents.cancel.finished" : "subagents.cancel.failed")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
