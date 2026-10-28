"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import { pickChatProvider } from "@/components/agent/chatProvider";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import css from "./agentRun.module.css";
import { SubagentTree } from "./SubagentTree";
import { TurnDiffPanel } from "./TurnDiffPanel";
import { clock, latency as fmtLatency, paragraphs, tokens as fmtTokens } from "./format";
import { groupActivity, segmentActivity, summarizeGroup } from "./activity";
import { Gate } from "./Gate";
import { ToolCard } from "./ToolCard";
import { useActiveRunStore } from "@/store/activeRunStore";
import { connectionLabel, isPinnedMismatch } from "./pinnedConnection";
import { rollupTotals, type TokenSource } from "./rollup";
import type { Block, RunState, Segment, ToolCall } from "./types";

/* ── Marker ────────────────────────────────────────────────────────────────
   The glyph hanging off the spine. Shape carries state, colour carries role —
   so a run reads correctly in a screenshot, and would still read correctly to
   someone who cannot separate the nine role hues. */
function Marker({ segment }: { segment: Segment }) {
  const role = ROLE_VAR[segment.type] ?? "var(--ink-faint)";
  const s = segment.state;

  if (s === "gate") {
    return (
      <span
        className="relative z-10 block h-[9px] w-[9px] rotate-45 rounded-none border"
        style={{ borderColor: "var(--warn)", background: "var(--sub-100)" }}
        aria-hidden
      />
    );
  }
  if (s === "error") {
    return (
      <span
        className="relative z-10 block h-[9px] w-[9px] rounded-none"
        style={{ background: "var(--fault)" }}
        aria-hidden
      />
    );
  }
  if (s === "running") {
    return (
      <span
        className="relative z-10 block h-[9px] w-[9px] rounded-none border-2"
        style={{ borderColor: role, background: "var(--sub-100)" }}
        aria-hidden
      />
    );
  }
  if (s === "done") {
    return (
      <span
        className="relative z-10 block h-[9px] w-[9px] rounded-none"
        style={{ background: role }}
        aria-hidden
      />
    );
  }
  if (s === "skipped") {
    // A PASS/FAIL branch this run didn't take — deliberately distinct from
    // the hollow "pending" marker below it (same shape would read as "still
    // waiting", not "this path wasn't selected").
    return (
      <span
        className="relative z-10 flex h-[9px] w-[9px] items-center justify-center rounded-none border border-dashed"
        style={{ borderColor: "var(--ink-faint)" }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className="relative z-10 block h-[7px] w-[7px] rounded-none border"
      style={{ borderColor: "var(--ink-faint)", background: "var(--sub-100)" }}
      aria-hidden
    />
  );
}

/* ── Tool call ─────────────────────────────────────────────────────────────
   One line per call. Machine-written throughout, so mono throughout: the name
   at ink, the arguments dimmed behind it, the result and duration hanging off
   the right edge where they line up into a column you can scan. */
function ToolRow({ call, transcriptRunId }: { call: ToolCall; transcriptRunId: string | null }) {
  const activeRunId = useActiveRunStore((s) => s.runId);
  // SEC gate 2026-09-24 (P2-FE-1): a control decision only ever targets the
  // *live* run — this card must not offer one for a replayed historical run
  // (HistoricalRunDetail.tsx) just because some *other* run happens to be
  // live right now. `runId` reaching ToolCard is null (buttons disabled)
  // unless this Transcript's own run genuinely is the active one.
  const runId = transcriptRunId !== null && transcriptRunId === activeRunId ? activeRunId : null;
  const [open, setOpen] = useState(false);
  // The composer's currently-selected connection — what a read result is fed
  // back to, hence what the card must disclose for a remote provider.
  const connections = useProviderStore((s) => s.connections);
  const chosenProviderId = useChatProviderStore((s) => s.chosenId);
  const connection = useMemo(() => {
    const pickedId = pickChatProvider(connections, chosenProviderId)?.id ?? null;
    return connections.find((c) => c.id === pickedId) ?? null;
  }, [connections, chosenProviderId]);
  // Chat tools broker calls (approval gate, denial, simulation) get the full
  // card — the approval card is a security surface (threat-model T5), not a
  // one-line log entry.
  if (call.approval || call.denied || call.simulated || call.origin) {
    return <ToolCard call={call} runId={runId} connection={connection} />;
  }
  const pending = call.ok === undefined;
  const failed = call.ok === false;
  const long = (call.result?.length ?? 0) > 64 || call.args.length > 60;

  return (
    <div
      className="mt-1 flex min-w-0 items-center gap-2 rounded-control border border-line-soft bg-sub-200 py-[3px] pl-2 pr-2"
      style={failed ? { borderColor: "var(--fault)" } : undefined}
    >
      <span
        className="h-[10px] w-[2px] flex-none rounded-none"
        style={{
          background: pending ? "var(--signal)" : failed ? "var(--fault)" : "var(--ink-faint)",
        }}
        aria-hidden
      />
      <span className="t-meta flex-none text-ink">{call.name}</span>
      <button
        type="button"
        disabled={!long}
        onClick={() => setOpen((v) => !v)}
        className={`t-meta min-w-0 flex-1 text-left text-ink-mute ${open ? "" : css.argEllipsis} ${
          long ? "hover:text-ink-mute" : "cursor-default"
        }`}
        title={long ? "Expand" : undefined}
      >
        {call.args}
      </button>

      {pending ? (
        <span className="t-meta flex-none" style={{ color: "var(--signal-text)" }}>
          running
        </span>
      ) : (
        <>
          <span
            className={`t-meta flex-none ${open ? "" : "max-w-[46%] truncate"}`}
            style={{ color: failed ? "var(--fault-text)" : "var(--ink-mute)" }}
          >
            {call.result}
          </span>
          {call.durationMs !== undefined && (
            <span className="t-meta flex-none text-ink-mute">{fmtLatency(call.durationMs)}</span>
          )}
        </>
      )}
    </div>
  );
}

/* ── Reasoning ─────────────────────────────────────────────────────────────
   Kept, but kept quiet: a thin rule, muted ink, and collapsed to a single line
   once the node has finished. Reasoning matters while it is happening and is
   clutter afterwards. */
function Reasoning({ text, done }: { text: string; done: boolean }) {
  const [open, setOpen] = useState(false);
  const show = open || !done;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!done}
        className="t-meta flex items-center gap-1.5 text-ink-mute disabled:cursor-default hover:text-ink-mute"
      >
        <span aria-hidden>{done ? (open ? "▾" : "▸") : "▾"}</span>
        {done ? "thought" : "thinking"}
      </button>
      {show && (
        <p
          className={`t-body mt-1 border-l pl-2.5 text-ink-mute ${css.prose}`}
          style={{ borderColor: "var(--line-soft)" }}
        >
          {text}
          {!done && <span className={css.caret} />}
        </p>
      )}
    </div>
  );
}

/* ── Tool run ──────────────────────────────────────────────────────────────
   A run of consecutive tool calls inside one step. Two or more fold to one
   summary line: counts by verb, failed/denied counts, and (while live) the
   call in flight. A lone call renders as a plain row — through this same
   component, so when a second call streams in the first row keeps its tree
   position (and its expanded-detail state) instead of remounting. Rows stay
   mounted but `hidden` while the group is collapsed, for the same reason.
   Closed once finished; open by default when something failed; held open —
   and not collapsible — while any call is parked on the approval gate,
   because an approval card must never be hidden. */
function ToolRun({ calls, runId }: { calls: ToolCall[]; runId: string | null }) {
  const summary = summarizeGroup({ kind: "activity", calls });
  const multi = calls.length > 1;
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const forced = multi && summary.awaitingApproval;
  const open = !multi || forced || (userOpen ?? summary.failed > 0);
  const panelId = `activity-${calls[0].callId}`;
  return (
    <div className={multi ? "mt-1" : undefined}>
      {multi ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-disabled={forced || undefined}
          onClick={() => {
            if (!forced) setUserOpen(!open);
          }}
          className={`t-meta flex w-full min-w-0 items-center gap-1.5 text-left hover:text-ink ${
            summary.failed > 0 ? "" : "text-ink-mute"
          } ${forced ? "cursor-default" : ""}`}
          style={summary.failed > 0 ? { color: "var(--fault-text)" } : undefined}
        >
          <span aria-hidden className="flex-none">
            {open ? "▾" : "▸"}
          </span>
          <span className="min-w-0 truncate">{summary.label}</span>
          {summary.current && (
            <span className="min-w-0 flex-1 truncate" style={{ color: "var(--signal-text)" }}>
              · {summary.current}
            </span>
          )}
        </button>
      ) : null}
      <div
        id={panelId}
        hidden={!open}
        className={multi ? "ml-1 border-l pl-2" : undefined}
        style={multi ? { borderColor: "var(--line-soft)" } : undefined}
      >
        {calls.map((c) => (
          <ToolRow key={c.callId} call={c} transcriptRunId={runId} />
        ))}
      </div>
    </div>
  );
}

function BlockView({ block, streaming, runId }: { block: Block; streaming: boolean; runId: string | null }) {
  if (block.kind === "tool") return <ToolRow call={block.call} transcriptRunId={runId} />;
  if (block.kind === "reason") return <Reasoning text={block.text} done={!streaming} />;
  const paras = paragraphs(block.text);
  return (
    <div className="mt-1.5 space-y-2">
      {paras.map((p, i) => (
        <p key={i} className={`t-body text-ink ${css.prose}`}>
          {p}
          {streaming && i === paras.length - 1 && <span className={css.caret} />}
        </p>
      ))}
    </div>
  );
}

/* ── One node ─────────────────────────────────────────────────────────────── */
function SegmentView({
  segment,
  first,
  last,
  onResolve,
  runId,
}: {
  segment: Segment;
  first: boolean;
  last: boolean;
  onResolve: (decision: "approve" | "reject", note: string) => void;
  runId: string | null;
}) {
  const Icon = ROLE_ICON[segment.type] ?? ROLE_ICON.agent;
  const role = ROLE_VAR[segment.type] ?? "var(--ink-faint)";
  const running = segment.state === "running";
  const pending = segment.state === "pending" || segment.state === "skipped";
  const items = useMemo(() => groupActivity(segment.blocks), [segment.blocks]);
  const lastItemIndex = items.length - 1;
  const stepActivity = useMemo(() => segmentActivity(segment.blocks), [segment.blocks]);

  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)]">
      <div
        className={`${css.gutter} ${first ? css.gutterFirst : ""} ${last ? css.gutterLast : ""}`}
      >
        <div className="flex h-[22px] items-center justify-center pl-[3px]">
          <Marker segment={segment} />
        </div>
      </div>

      <div className={`min-w-0 pb-3 ${pending ? "opacity-45" : ""}`}>
        {/* Node header — label left, identity centre-dim, cost right. */}
        <div className="flex h-[22px] min-w-0 items-center gap-2">
          <Icon size={12} strokeWidth={1.75} style={{ color: role }} className="flex-none" />
          <span className="t-title min-w-0 flex-none truncate text-ink">{segment.label}</span>
          <span className="t-meta min-w-0 flex-1 truncate text-ink-mute">
            {segment.intrinsic
              ? segment.type
              : `${segment.type} · ${segment.model || segment.adapter}`}
          </span>
          {stepActivity && (
            <span
              role="note"
              aria-label={`${segment.label} activity`}
              className="t-meta max-w-[55%] flex-none truncate"
              style={{ color: stepActivity.failed > 0 ? "var(--fault-text)" : "var(--ink-mute)" }}
            >
              {stepActivity.label}
            </span>
          )}
          {segment.state === "done" && (
            <span className="t-meta flex-none text-ink-mute">
              {segment.latencyMs ? fmtLatency(segment.latencyMs) : null}
              {segment.tokens ? ` · ${segment.tokensEstimated ? "~" : ""}${fmtTokens(segment.tokens)} tok` : null}
            </span>
          )}
          {running && segment.phase && (
            <span className="t-meta flex-none" style={{ color: "var(--signal-text)" }}>
              {segment.phase}
              {segment.phaseDetail ? ` · ${segment.phaseDetail}` : ""}
            </span>
          )}
        </div>

        {items.map((item, i) =>
          item.kind === "activity" || item.kind === "tool" ? (
            // Keyed by the run's first call so a solo call that becomes a
            // group (second call arrives) is the same element, not a remount.
            <ToolRun
              key={`t-${item.kind === "activity" ? item.calls[0].callId : item.call.callId}`}
              calls={item.kind === "activity" ? item.calls : [item.call]}
              runId={runId}
            />
          ) : (
            <BlockView key={`b-${i}`} block={item} streaming={running && i === lastItemIndex} runId={runId} />
          ),
        )}

        {/* An intrinsic node has no adapter and therefore no stream — its
            output is the whole of it, so it is shown rather than hidden. */}
        {segment.intrinsic && segment.type !== "hitl" && segment.output && (
          <p className={`t-body mt-1.5 text-ink-dim ${css.prose}`}>{segment.output}</p>
        )}

        {segment.gate && <Gate segment={segment} onResolve={onResolve} />}

        {segment.error && (
          <div
            className="mt-1.5 rounded-control border px-2 py-1.5"
            style={{ borderColor: "var(--fault)" }}
          >
            <span className="t-label" style={{ color: "var(--fault-text)" }}>
              fault
            </span>
            <p className={`t-body mt-0.5 text-ink-dim ${css.prose}`}>{segment.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Rollup ────────────────────────────────────────────────────────────────
   Two ways of answering "what did this run cost": one number up top, then
   where it went underneath. Mirrors RunControls.tsx's own metric pattern
   (mono value + dim unit, reusing format.ts's formatters verbatim) rather
   than importing RunControls itself — that component also carries the
   Start/Stop/Step transport buttons, which belong to the composer bar
   (AgentStage.tsx), not a scrolling transcript log. */
function Metric({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="t-meta flex items-baseline gap-1 px-2.5 first:pl-0">
      <span className="text-ink-dim">{value}</span>
      <span className="text-ink-mute">{unit}</span>
    </span>
  );
}

/** Distinct from the default rows — a node that ran on a connection other
    than the one the chat composer would use today. Amber like the rest of
    the panel's "notice this" vocabulary (gates, unreachable-node notices),
    not red like a fault: nothing went wrong, it is just worth knowing. */
function PinnedBadge({ label }: { label: string }) {
  return (
    <span
      className="t-meta inline-flex items-center gap-1 rounded-control border px-1.5 py-px text-ink-dim"
      style={{ borderColor: "var(--warn)" }}
      title={`Ran on a pinned connection different from today's chat default: ${label}`}
    >
      <span className="h-[5px] w-[5px] flex-none rounded-none" style={{ background: "var(--warn)" }} aria-hidden />
      pinned: {label}
    </span>
  );
}

/** Distinct from `PinnedBadge` on purpose (PROVIDER-FAILOVER story, AC#5):
    "pinned" means an author chose this connection; "failover" means the
    engine chose it *for* them because an earlier one failed — conflating the
    two vocabularies would hide the one thing this badge exists to disclose.
    Signal teal (the app's other identity colour, "live/confirmed") rather
    than warn amber ("notice this, unchanged") or fault red ("something is
    broken now") — a completed failover is neither of those, it is the run
    recovering the way it was configured to. */
function FailoverBadge({
  attempts,
  servedLabel,
  connections,
}: {
  attempts: NonNullable<Segment["failover"]>["attempts"];
  servedLabel: string;
  connections: Connection[];
}) {
  const rejected = attempts
    .map((a) => `${connectionLabel(connections, a.connectionId)} (${a.reason})`)
    .join("; ");
  return (
    <span
      className="t-meta inline-flex items-center gap-1 rounded-control border px-1.5 py-px text-ink-dim"
      style={{ borderColor: "var(--signal)" }}
      title={`Failover: ${rejected} rejected before this node ran on ${servedLabel}.`}
    >
      <span className="h-[5px] w-[5px] flex-none rounded-full" style={{ background: "var(--signal)" }} aria-hidden />
      failover: {attempts.length} tried
    </span>
  );
}

const TOKEN_SOURCE_COPY: Record<TokenSource, { label: string; title: string }> = {
  live: {
    label: "counting",
    title: "The run is still running: these figures are still moving and are not final.",
  },
  measured: {
    label: "tokens measured",
    title: "Token counts were reported by the provider, not guessed.",
  },
  estimated: {
    label: "tokens estimated",
    title:
      "At least one token count was estimated from the length of the output because the provider did not report usage.",
  },
  unconfirmed: {
    label: "tokens unconfirmed",
    title:
      "This run's record does not say whether its token counts were reported by the provider or estimated.",
  },
};

function RunRollup({ run, elapsed }: { run: RunState; elapsed?: number }) {
  if (!run.startedAt) return null; // nothing has run yet — no honest total to show
  const totals = rollupTotals(run, elapsed);
  const copy = TOKEN_SOURCE_COPY[totals.tokenSource];
  const pulsing = totals.tokenSource === "live";
  return (
    <div className="mb-2 flex items-center divide-x divide-line-soft border-b border-line-soft pb-2">
      {totals.elapsedState === "unrecorded" ? (
        <span
          className="t-meta flex items-baseline gap-1 px-2.5 first:pl-0"
          title="The run finished, but its duration was not captured."
        >
          <span className="text-ink-dim">not recorded</span>
          <span className="text-ink-mute">duration</span>
        </span>
      ) : (
        <Metric value={clock(totals.elapsedMs ?? 0)} unit="elapsed" />
      )}
      <Metric value={fmtTokens(totals.tokens)} unit="tok" />
      <Metric
        value={run.plan.length ? `${run.totals.nodesRun}/${run.plan.length}` : "—"}
        unit="nodes"
      />
      {/* Provenance of the token count, always on screen. "estimated" is
          reserved for counts that really were estimated; a duration that was
          never captured is reported in its own cell, not smeared onto this. */}
      <span className="t-meta ml-auto flex items-center gap-1.5 pl-2.5 text-ink-mute" title={copy.title}>
        <span
          className={`h-[5px] w-[5px] flex-none rounded-full ${
            totals.tokenSource === "measured"
              ? "bg-signal"
              : `bg-ink-faint${pulsing ? " animate-pulse" : ""}`
          }`}
          aria-hidden
        />
        {copy.label}
      </span>
    </div>
  );
}

function RouteDecisionProvenance({ decision }: { decision: NonNullable<RunState["routeDecision"]> }) {
  const source = decision.source === "laya" ? "Laya" : decision.source === "model_fallback" ? "model fallback" : "model";
  const reason =
    decision.reason === "unavailable"
      ? "Laya unavailable"
      : decision.reason === "provider_unavailable"
        ? "Provider unavailable; routed safely to Harness"
      : decision.reason === "low_confidence"
        ? "Laya confidence below threshold"
        : decision.reason;
  const confidence = decision.confidence == null ? null : `${Math.round(decision.confidence * 100)}% confidence`;
  const outcome = decision.engageHarness ? "Harness" : "Nilo";
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control border border-line-soft px-2 py-1.5 text-ink-dim"
      role="group"
      aria-label="Routing decision provenance"
    >
      <span className="t-meta">{`decided by ${source}`}</span>
      <span className="t-meta text-ink-mute">{`selected ${outcome}`}</span>
      {confidence && <span className="t-meta text-ink-mute">{confidence}</span>}
      {reason && decision.reason !== "confident" && <span className="t-meta text-ink-mute">{reason}</span>}
    </div>
  );
}

/** Per-node latency + tokens as a real table, not another scroll of
    one-liners — same numbers the chronological view already shows inline
    per segment, laid out so they can be scanned and compared instead of
    read one at a time. Chronological (plan) order, not re-sorted by cost:
    this is an attribution of the run's own append-only event log, not a
    leaderboard. */
function NodeBreakdown({
  segments,
  defaultConnectionId,
  connections,
}: {
  segments: Segment[];
  defaultConnectionId: string | null;
  connections: Connection[];
}) {
  if (!segments.length) return null;
  return (
    <table className="mb-2 w-full border-collapse">
      <caption className="sr-only">Per-node latency and token attribution for this run</caption>
      <thead>
        <tr className="t-label text-ink-mute">
          <th scope="col" className="px-1.5 pb-1 text-left font-semibold">
            node
          </th>
          <th scope="col" className="px-1.5 pb-1 text-right font-semibold">
            latency
          </th>
          <th scope="col" className="px-1.5 pb-1 text-right font-semibold">
            tokens
          </th>
        </tr>
      </thead>
      <tbody>
        {segments.map((s) => {
          const mismatch = isPinnedMismatch(s.connectionId, defaultConnectionId);
          const failover = s.failover?.attempts.length ? s.failover : undefined;
          return (
            <tr key={s.nodeId} className="border-t border-line-soft">
              <td className="px-1.5 py-1">
                <span className="t-title text-ink">{s.label}</span>
                {mismatch && (
                  <span className="ml-2 inline-block align-middle">
                    <PinnedBadge label={connectionLabel(connections, s.connectionId!)} />
                  </span>
                )}
                {failover && (
                  <span className="ml-2 inline-block align-middle">
                    <FailoverBadge
                      attempts={failover.attempts}
                      servedLabel={connectionLabel(connections, s.connectionId!)}
                      connections={connections}
                    />
                  </span>
                )}
              </td>
              <td className="px-1.5 py-1 text-right">
                {s.latencyMs != null ? (
                  <span className="t-meta text-ink-dim">{fmtLatency(s.latencyMs)}</span>
                ) : (
                  <span className="t-meta text-ink-dim" title="Latency was not captured for this node.">
                    <span aria-hidden>—</span>
                    <span className="sr-only">not captured</span>
                  </span>
                )}
              </td>
              <td className="px-1.5 py-1 text-right">
                {s.tokens != null && s.tokensEstimated ? (
                  <span className="t-meta text-ink-dim" title="Estimated from the length of the output; the provider did not report usage.">
                    ~{fmtTokens(s.tokens)}
                  </span>
                ) : (
                  <span className="t-meta text-ink-dim">{s.tokens != null ? fmtTokens(s.tokens) : "—"}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── The transcript ───────────────────────────────────────────────────────── */
export function Transcript({
  run,
  onResolve,
  elapsed,
}: {
  run: RunState;
  onResolve: (decision: "approve" | "reject", note: string) => void;
  /** Live-ticking ms from useRunStream — optional because a replayed
      historical run (HistoricalRunDetail.tsx) has no live clock at all and
      relies on `rollupElapsedMs` falling back to the backend-measured
      `totals.elapsedMs` instead. */
  elapsed?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const connections = useProviderStore((s) => s.connections);
  const chosenProviderId = useChatProviderStore((s) => s.chosenId);
  const defaultConnectionId = useMemo(
    () => pickChatProvider(connections, chosenProviderId)?.id ?? null,
    [connections, chosenProviderId]
  );
  const attributed = useMemo(
    () => run.plan.filter((s) => s.state === "done" || s.state === "error"),
    [run.plan]
  );

  /* Follow the stream, but stop following the moment someone scrolls up — a
     transcript that yanks you back to the bottom while you are reading is a
     transcript you cannot read. */
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const shown = run.plan.filter((s) => s.state !== "pending" || run.status === "idle");
  const visible = shown.length ? shown : run.plan;

  return (
    <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2.5">
      {run.notices.map((n, i) => (
        <div
          key={i}
          className="mb-2 rounded-control border px-2 py-1.5"
          style={{ borderColor: "var(--warn)" }}
        >
          <span className="t-body" style={{ color: "var(--warn-text)" }}>
            {n}
          </span>
        </div>
      ))}

      <RunRollup run={run} elapsed={elapsed} />
      {run.routeDecision && <RouteDecisionProvenance decision={run.routeDecision} />}
      <SubagentTree runId={run.runId} runLive={run.status === "running" || run.status === "starting"} status={run.status} subagents={run.subagents} />
      <NodeBreakdown segments={attributed} defaultConnectionId={defaultConnectionId} connections={connections} />

      {visible.map((s, i) => (
        <SegmentView
          key={s.nodeId}
          segment={s}
          first={i === 0}
          last={i === visible.length - 1}
          onResolve={onResolve}
          runId={run.runId}
        />
      ))}

      {run.turnDiff && <TurnDiffPanel runId={run.runId} turnDiff={run.turnDiff} />}
      {run.status === "complete" && (
        <div className="grid grid-cols-[24px_minmax(0,1fr)] pb-2">
          <div />
          <div className="t-meta flex items-baseline gap-2 text-ink-mute">
            <span className="h-px flex-1 bg-line-soft" aria-hidden />
            <span>run complete</span>
          </div>
        </div>
      )}
      {run.compactions.map((c, i) => (
        <div key={`compaction-${i}`} className="grid grid-cols-[24px_minmax(0,1fr)] pb-1">
          <div />
          <p className="t-meta text-ink-mute">
            context compacted — {fmtTokens(c.beforeTokens)} → {fmtTokens(c.afterTokens)} tok
          </p>
        </div>
      ))}
      {run.budget && (
        <div className="grid grid-cols-[24px_minmax(0,1fr)] pb-2">
          <div />
          <p role="status" className="t-meta" style={{ color: "var(--warn-text)" }}>
            budget_exceeded — stopped at {fmtTokens(run.budget.usedTokens)} of {fmtTokens(run.budget.maxTokens)} tok
          </p>
        </div>
      )}
      {run.status === "stopped" && !run.budget && (
        <div className="grid grid-cols-[24px_minmax(0,1fr)] pb-2">
          <div />
          <div className="t-meta flex items-baseline gap-2" style={{ color: "var(--ink-mute)" }}>
            <span className="h-px flex-1 bg-line-soft" aria-hidden />
            <span>stopped — downstream nodes never ran</span>
          </div>
        </div>
      )}
    </div>
  );
}
