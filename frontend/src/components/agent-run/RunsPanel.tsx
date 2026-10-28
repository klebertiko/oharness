"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RotateCw } from "lucide-react";

import { RunEvidence } from "./RunEvidence";
import { Panel } from "@/components/shell/Panel";
import { ListGroup, ListRow, StatusDot, type Tone } from "@/components/shell/ListRow";
import { runResultText, runsApi, type RunLog, type RunLogDetail, type RunStatus } from "@/lib/runsApi";

/**
 * Activity — one place for every harness execution, wherever it came from: a
 * chat message with the harness on, or a test run in Studio. Each row is one
 * run: status, which harness, when, how long. Opening
 * it shows what the engine kept. Backed by the sidecar's `/execute/logs`
 * store (last 50).
 */

const STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "ok" },
  complete: { label: "Completed", tone: "ok" },
  error: { label: "Failed", tone: "fault" },
  failed: { label: "Failed", tone: "fault" },
  stopped: { label: "Stopped", tone: "warn" },
  interrupted: { label: "Interrupted", tone: "warn" },
  pending: { label: "Not started", tone: "warn" },
  budget_exceeded: { label: "Budget exceeded", tone: "warn" },
  unknown: { label: "Unknown", tone: "warn" },
};

export function RunsPanel() {
  const [runs, setRuns] = useState<RunLog[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError("");
    runsApi
      .list()
      .then(setRuns)
      .catch((e: Error) => {
        setRuns([]);
        setError(e.message || "Couldn't reach the activity log");
      });
  }, []);

  useEffect(load, [load]);

  return (
    <Panel
      title="Activity"
      className="h-full"
      actions={
        <button
          type="button"
          onClick={load}
          aria-label="Refresh activity"
          title="Refresh"
          className="grid h-6 w-6 place-items-center rounded-panel text-ink-mute transition-colors hover:bg-sub-200 hover:text-ink"
        >
          <RotateCw size={13} strokeWidth={1.8} />
        </button>
      }
    >
      {openId ? (
        <RunDetail id={openId} onBack={() => setOpenId(null)} onContinued={load} />
      ) : (
        <RunList runs={runs} error={error} onOpen={setOpenId} />
      )}
    </Panel>
  );
}

function RunList({
  runs,
  error,
  onOpen,
}: {
  runs: RunLog[] | null;
  error: string;
  onOpen: (id: string) => void;
}) {
  const groups = useMemo(() => (runs ? groupByDay(runs) : []), [runs]);

  if (runs === null) return <p className="px-3 py-3 text-body text-ink-mute">Loading…</p>;

  if (runs.length === 0) {
    return (
      <div className="px-3 py-4">
        <p className="text-title text-ink">No activity yet.</p>
        <p className="mt-1 text-body text-ink-mute">
          {error || "A chat with the harness on, or a test run in Studio, shows up here."}
        </p>
      </div>
    );
  }

  return (
    <>
      {error && <p className="mx-3 mt-2 text-body text-warn-text">{error}</p>}
      {groups.map(({ label, items }) => (
        <ListGroup key={label} label={label}>
          {items.map((run) => {
            const s = STATUS[run.status];
            return (
              <ListRow
                key={run.id}
                title={run.harnessName || (run.source === "direct" ? "Direct chat" : "Ad-hoc run")}
                subtitle={`${run.source === "direct" ? "Direct · " : ""}${s.label}${durationText(run) ? ` · ${durationText(run)}` : ""}`}
                leading={<StatusDot tone={s.tone} pulse={run.status === "running"} />}
                trailing={<span className="text-meta text-ink-mute">{clockTime(run.startedAt)}</span>}
                onSelect={() => onOpen(run.id)}
              />
            );
          })}
        </ListGroup>
      ))}
    </>
  );
}

function RunDetail({ id, onBack, onContinued }: { id: string; onBack: () => void; onContinued: () => void }) {
  const [run, setRun] = useState<RunLogDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    runsApi
      .get(id)
      .then((r) => alive && setRun(r))
      .catch((e: Error) => alive && setError(e.message || "Couldn't load this run"));
    return () => {
      alive = false;
    };
  }, [id]);

  const s = run ? STATUS[run.status] : null;
  const text = run ? runResultText(run.result) : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={onBack}
        className="flex flex-none items-center gap-1.5 px-2.5 py-2 text-body font-medium text-ink-mute transition-colors hover:text-ink"
      >
        <ArrowLeft size={13} strokeWidth={1.8} />
        All activity
      </button>

      {error && <p className="px-3 text-body text-fault-text">{error}</p>}

      {run && s && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <p className="text-reading font-medium text-ink">{run.harnessName || "Ad-hoc run"}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
            <dt className="text-ink-mute">Status</dt>
            <dd className="flex items-center gap-1.5 text-ink-dim">
              <StatusDot tone={s.tone} />
              {s.label}
            </dd>
            <dt className="text-ink-mute">Started</dt>
            <dd className="text-ink-dim">{fullTime(run.startedAt)}</dd>
            <dt className="text-ink-mute">Duration</dt>
            <dd className="text-ink-dim">{durationText(run) || "—"}</dd>
          </dl>

          <RunEvidence detail={run} onContinued={onContinued} />
          {text ? (
            <pre className="mt-3 whitespace-pre-wrap rounded-float bg-sub-200 p-2.5 font-mono text-meta leading-5 text-ink-dim">
              {text}
            </pre>
          ) : (
            <p className="mt-3 text-body text-ink-mute">This run kept no output.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── time helpers ────────────────────────────────────────────────────────────
const DAY = 86_400_000;

function groupByDay(runs: RunLog[]): { label: string; items: RunLog[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const out: { label: string; items: RunLog[] }[] = [];
  const bucketOf = (ts: number) =>
    ts >= startOfToday ? "Today" : ts >= startOfToday - DAY ? "Yesterday" : "Earlier";
  for (const run of runs) {
    const ts = run.startedAt ? Date.parse(run.startedAt) : 0;
    const label = bucketOf(ts);
    (out.find((g) => g.label === label) ?? out[out.push({ label, items: [] }) - 1]).items.push(run);
  }
  return out;
}

function durationText(run: Pick<RunLog, "startedAt" | "finishedAt">): string {
  if (!run.startedAt || !run.finishedAt) return "";
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function clockTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(Date.parse(iso));
  } catch {
    return "";
  }
}

function fullTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(Date.parse(iso));
  } catch {
    return "—";
  }
}
