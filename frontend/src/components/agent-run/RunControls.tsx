"use client";
import { Button } from "@/components/ui/Button";
import { clock, tokens as fmtTokens } from "./format";
import type { RunState, RunStatus } from "./types";

const STATE: Record<RunStatus, { word: string; color: string }> = {
  idle: { word: "idle", color: "var(--ink-mute)" },
  starting: { word: "opening", color: "var(--signal-text)" },
  running: { word: "running", color: "var(--signal-text)" },
  gate: { word: "waiting on you", color: "var(--warn-text)" },
  paused: { word: "parked", color: "var(--warn-text)" },
  stopped: { word: "stopped", color: "var(--ink-mute)" },
  complete: { word: "complete", color: "var(--ink-dim)" },
  error: { word: "faulted", color: "var(--fault-text)" },
};

function Btn({
  children,
  onClick,
  disabled,
  tone = "quiet",
  chord,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "quiet" | "danger";
  chord?: string;
  title?: string;
}) {
  return (
    <Button
      size="sm"
      variant={tone === "primary" ? "primary" : tone === "danger" ? "danger" : "secondary"}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
      {chord && (
        <kbd
          className="t-meta rounded-control border px-1"
          style={tone === "primary" ? { borderColor: "var(--signal-ink)", color: "var(--signal-ink)" } : { borderColor: "var(--line)" }}
        >
          {chord}
        </kbd>
      )}
    </Button>
  );
}

function Metric({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="t-meta flex items-baseline gap-1 px-2.5">
      <span className="text-ink-dim">{value}</span>
      <span className="text-ink-mute">{unit}</span>
    </span>
  );
}

/**
 * Transport bar.
 *
 * One primary control that changes identity with the run's state, rather than
 * a fixed row of four buttons three of which are always dead. The metrics on
 * the right are the only numbers in the panel that update continuously, so
 * they are mono and tabular — the digits must not shuffle sideways as the
 * clock ticks.
 */
export function RunControls({
  run,
  elapsed,
  live,
  onStart,
  onStop,
  onStep,
}: {
  run: RunState;
  elapsed: number;
  live: boolean;
  onStart: () => void;
  onStop: () => void;
  onStep: () => void;
}) {
  const s = STATE[run.status];
  const parked = run.status === "paused";

  return (
    <div className="flex h-[34px] flex-none items-center gap-2 border-b border-line bg-sub-100 px-2.5">
      <span
        className="h-[7px] w-[7px] flex-none rounded-none"
        style={{ background: s.color }}
        aria-hidden
      />
      <span className="t-label flex-none" style={{ color: s.color }}>
        {s.word}
      </span>

      <span className="mx-1 h-[14px] w-px flex-none bg-line-soft" aria-hidden />

      {live ? (
        <>
          <Btn tone="danger" onClick={onStop} title="Stop after the current node">
            Stop
          </Btn>
          {parked && (
            <Btn tone="primary" onClick={onStep} chord="⏎" title="Run the next node">
              Step
            </Btn>
          )}
        </>
      ) : (
        <Btn tone="primary" onClick={onStart} chord="⌘⏎" title="Run the harness">
          {run.runId ? "Run again" : "Run"}
        </Btn>
      )}

      <span className="flex-1" />

      <div className="flex flex-none items-center divide-x divide-line-soft">
        <Metric value={run.startedAt ? clock(elapsed) : "—"} unit="elapsed" />
        <Metric value={fmtTokens(run.totals.tokens)} unit="tok" />
        <Metric
          value={run.plan.length ? `${run.totals.nodesRun}/${run.plan.length}` : "—"}
          unit="nodes"
        />
      </div>
    </div>
  );
}
