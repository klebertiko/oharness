"use client";
import { NiloSprite, type NiloState } from "./NiloSprite";
import { tokens as fmtTokens } from "@/components/agent-run/format";

const VERBS: Partial<Record<NiloState, string[]>> = {
  thinking: ["Thinking", "Hooting", "Pondering", "Perching on it", "Preening the plan", "Untangling", "Weaving the harness"],
  working: ["Working", "Wiring nodes", "Running checks", "Typing furiously", "Building"],
  waiting: ["Waiting for you"],
};

function formatElapsed(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Live run status: an animated Nilo, a rotating verb, and the run's elapsed
 * time + running token total. Both numbers are driven entirely by props —
 * `elapsed` (ms, from useRunStream()'s real clock) and `tokens` (the
 * run-wide `run.totals.tokens`) — this component keeps no clock and does no
 * token math of its own, so the verb/elapsed pairing can never drift from
 * the real run, and it never invents a reading: with `tokens` left
 * undefined, no token segment renders at all (never a fake "0 tok").
 *
 * Deliberate three-tier hierarchy (personality > current step > raw
 * metrics), unlike a flat "10m 28s · 296.7k tokens · 2 running tasks ·
 * Thought for 4s" status pill with everything in one undifferentiated row:
 * the whimsical verb stays the loud, personable headline; `detail` (the
 * real current step, e.g. "Walking the harness graph.") sits below it as
 * its own sentence; elapsed/tokens are demoted to small faint mono digits —
 * a quiet "still alive" signal, not competing for attention with either.
 * The moving parts are hidden from screen readers; they hear one stable line.
 */
export function ThinkingStatus({
  state = "thinking",
  detail,
  elapsed = 0,
  tokens,
}: {
  state?: NiloState;
  detail?: string;
  /** Milliseconds since the run started (useRunStream().elapsed). */
  elapsed?: number;
  /** Run-wide running total (run.totals.tokens) — never a segment's own count. */
  tokens?: number;
}) {
  const elapsedSec = Math.floor(elapsed / 1000);
  const verbs = VERBS[state] ?? VERBS.thinking ?? [];
  const verb = verbs[Math.floor(elapsedSec / 3) % verbs.length];

  return (
    <div role="status" className="flex items-center gap-3">
      <NiloSprite state={state} crop="face" cell={2} />
      <div className="min-w-0">
        <p className="text-title leading-5 text-ink">
          <span aria-hidden>{verb}…</span>
          <span className="sr-only">OHarness is working</span>{" "}
          <span aria-hidden className="font-mono text-body tabular-nums text-ink-mute">
            {formatElapsed(elapsedSec)}
            {tokens !== undefined ? ` · ${fmtTokens(tokens)} tok` : ""}
          </span>
        </p>
        {detail && <p className="text-body leading-5 text-ink-mute">{detail}</p>}
      </div>
    </div>
  );
}
