"use client";
import { useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { forjaApi, type LiveRun, type RunBoard } from "./forjaApi";
import { useExplain } from "./useForja";

/**
 * Live runs. Stopping ends the process and leaves the worktree. Steering sends a message into the run that is going.
 */
export function ForjaRuns({ board, onChanged }: { board: RunBoard | null; onChanged: () => void }) {
  const { t, number } = useI18n();
  const explain = useExplain();
  const [error, setError] = useState<string | null>(null);
  if (!board) {
    return <Notice tone="warn" className="m-3" title={t("forja.runner.title")}>{t("forja.runner.body")}</Notice>;
  }
  const act = async (run: () => Promise<unknown>) => {
    try {
      await run();
      setError(null);
      onChanged();
    } catch (e) {
      setError(explain(e));
    }
  };
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-title">{t("forja.runs.now", { n: number(board.running), limit: number(board.limit) })}</p>
      {error && <Notice tone="fault">{error}</Notice>}
      {board.runs.length === 0 ? (
        <p className="text-ink-mute">{t("forja.runs.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {board.runs.map((run) => (
            <RunRow key={run.run_id} run={run} onStop={() => void act(() => forjaApi.stopRun(run.run_id))} onSteer={(text) => void act(() => forjaApi.steerRun(run.run_id, text))} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RunRow({ run, onStop, onSteer }: { run: LiveRun; onStop: () => void; onSteer: (text: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const live = run.status === "running" || run.status === "starting";
  const engine = run.engine || run.harness;
  return (
    <li className="rounded-control border border-line-soft p-3">
      <p className="text-body">{run.title}</p>
      <p className="text-ink-dim">
        {t(`forja.stage.${run.stage}` as MessageKey)} · {t(`forja.runStatus.${run.status}` as MessageKey)}
        {engine ? ` · ${t("forja.runs.engine")}: ${engine}` : ""}
      </p>
      {run.children.length > 0 && (
        <ul className="mt-1 text-ink-dim">
          {run.children.map((child) => (
            <li key={child.run_id}>{t("forja.runs.child")}: {child.label}</li>
          ))}
        </ul>
      )}
      {live && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={onStop}>{t("forja.runs.stop")}</Button>
          </div>
          <Input label={t("forja.runs.steerHint")} value={text} onChange={(e) => setText(e.target.value)} />
          <div>
            <Button size="sm" disabled={!text.trim()} onClick={() => { onSteer(text.trim()); setText(""); }}>{t("forja.runs.steer")}</Button>
          </div>
        </div>
      )}
    </li>
  );
}
