import type { RunState } from "@/components/agent-run/types";
import { tr } from "@/i18n/store";

/**
 * The assistant's reply in the chat is a *result*, not a transcript — the
 * step-by-step is one click away under "Show run detail". So: collect the
 * distinct text each segment produced, drop repeats (a mock run emits the
 * same placeholder from every node), and show the final answer. When several
 * distinct steps spoke, lead with a one-line note of how many ran.
 */
export function summarizeRunOutput(run: RunState): string {
  const errors: string[] = [];
  const texts: string[] = [];

  for (const seg of run.plan) {
    if (seg.error) {
      errors.push(`${seg.label}: ${seg.error}`);
      continue;
    }
    // `output` (from node_done) *is* the assembled text of `blocks` (from
    // node_stream) — one node's final answer, not two. Concatenating both
    // duplicated every reply verbatim (surfaced live, 2026-09-11: a single-
    // node chat run's own message read the same sentence twice). `output`
    // wins whenever the node actually finished; blocks are the fallback for
    // a segment summarized mid-stream, before node_done has landed.
    const joined = (
      seg.output?.trim() ||
      seg.blocks
        .filter((b) => b.kind === "text" || b.kind === "reason")
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join("\n\n")
    ).trim();
    if (joined && joined !== texts[texts.length - 1]) texts.push(joined);
  }

  if (errors.length && !texts.length) {
    return `Run failed.\n\n${errors.join("\n")}`;
  }

  if (texts.length === 0) {
    if (run.status === "error") return "Run failed.";
    if (run.status === "stopped") return run.budget ? tr("run.stoppedAtCeiling") : "Run stopped.";
    if (run.status === "complete") return "The run finished without a text answer.";
    return "";
  }

  const answer = texts[texts.length - 1];
  if (texts.length === 1) return answer;

  const steps = run.plan.filter((s) => !s.error && (s.output?.trim() || s.blocks.length)).length;
  return `${answer}\n\n_${steps} steps ran — open run detail for each._`;
}
