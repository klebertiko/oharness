"use client";
import { ROLE_VAR } from "@/lib/roles";
import css from "./agentRun.module.css";
import type { RunState, Segment } from "./types";

const RUNG: Record<Segment["state"], string> = {
  pending: "",
  running: css.rungRunning,
  gate: css.rungGate,
  done: css.rungDone,
  error: css.rungError,
  skipped: css.rungSkipped,
};

/**
 * The plan, as one bar.
 *
 * A harness run is not an open-ended conversation — the graph fixes how many
 * steps there are before the first token arrives, so the panel can show the
 * whole route up front and fill it in. Each rung carries its node's role hue,
 * which means the bar is also a legend for the transcript below it: the colour
 * you see travelling here is the colour of the marker you scroll to.
 */
export function RunLadder({ run }: { run: RunState }) {
  const active = run.plan[run.cursor];
  const nextUp = run.awaitingStep;

  return (
    <div className="flex-none border-b border-line bg-sub-100 px-2.5 pb-2 pt-2">
      <div className="flex items-center gap-[2px]" role="progressbar"
        aria-valuemin={0}
        aria-valuemax={run.plan.length}
        aria-valuenow={run.totals.nodesRun}
        aria-label="Harness plan progress">
        {run.plan.length === 0 && <div className={css.rung} />}
        {run.plan.map((s) => (
          <div
            key={s.nodeId}
            title={`${s.label} — ${s.state}`}
            className={`${css.rung} ${RUNG[s.state]}`}
            style={{ ["--role" as string]: ROLE_VAR[s.type] }}
          />
        ))}
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className="h-[9px] w-[2px] flex-none translate-y-[1px] rounded-none"
          style={{ background: active ? ROLE_VAR[active.type] : "var(--ink-faint)" }}
          aria-hidden
        />
        <span className="t-body min-w-0 flex-1 truncate text-ink-dim">
          {nextUp ? (
            <>
              <span className="text-ink-mute">next up </span>
              {nextUp.label}
            </>
          ) : active ? (
            active.label
          ) : (
            <span className="text-ink-mute">
              {run.plan.length ? "Plan loaded" : "No run yet — the plan appears here"}
            </span>
          )}
        </span>
        <span className="t-meta flex-none text-ink-mute">
          {run.plan.length ? `${Math.max(run.cursor + 1, 0)}/${run.plan.length}` : "—"}
        </span>
      </div>
    </div>
  );
}
