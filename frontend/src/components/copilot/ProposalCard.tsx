"use client";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useReactFlow } from "@xyflow/react";
import { PROPOSAL_STATES } from "@/lib/copilot/rules";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore, type Proposal } from "@/store/copilotStore";

const plural = (n: number) => `${n} change${n === 1 ? "" : "s"}`;
const COMPOSER_ID = "nilo-composer";

/**
 * One proposal, one lifecycle (ADR 0010, table in `lib/copilot/rules.ts`).
 * While pending the changes are only previewed on the canvas: each can be
 * dropped, nothing is committed until Apply, and Apply is a single undo step.
 */
export function ProposalCard({ turnId, proposal }: { turnId: string; proposal: Proposal }) {
  const { apply, reject, keep, undo, toggleOp, revalidate, markSeen } = useCopilotStore.getState();
  const undoAvailable = useCopilotStore((s) => s.undoAvailable(turnId));
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  // Re-checked whenever the graph moves, so a stale proposal says so before Apply is pressed.
  const shape = useCanvasStore((s) => `${s.nodes.map((n) => `${n.id}:${n.type}`).join(",")}|${s.edges.map((e) => e.id).join(",")}`);
  const isRunning = useCanvasStore((s) => s.isRunning);
  const { setCenter, getNode } = useReactFlow();
  const applyRef = useRef<HTMLButtonElement>(null);

  const rules = PROPOSAL_STATES[proposal.state];
  const total = proposal.lines.length;
  const chosen = total - proposal.excluded.length;

  useEffect(() => {
    if (proposal.state === "pending") revalidate(turnId);
  }, [proposal.state, turnId, revalidate, shape]);

  useEffect(() => {
    if (proposal.state !== "pending" || proposal.seen) return;
    markSeen(turnId);
    applyRef.current?.focus();
  }, [proposal.state, proposal.seen, turnId, markSeen]);

  if (proposal.state === "kept") return <p className="t-meta text-ink-mute">Kept {plural(total)}</p>;
  if (proposal.state === "undone") return <p className="t-meta text-ink-mute">Undone</p>;
  if (proposal.state === "rejected") return <p className="t-meta text-ink-mute">Discarded</p>;
  if (proposal.state === "replaced") return <p className="t-meta text-ink-mute">Replaced by a newer request</p>;

  const reveal = (nodeId: string) => {
    setSelectedNode(nodeId);
    const n = getNode(nodeId);
    if (n) setCenter(n.position.x + 106, n.position.y + 50, { zoom: 1, duration: 260 });
  };
  const refine = () => document.getElementById(COMPOSER_ID)?.focus();

  const applied = proposal.state === "applied";
  return (
    <section
      aria-label={applied ? "Applied changes" : "Proposed changes"}
      className="rounded-float border border-line bg-sub-200"
      onKeyDown={(e) => {
        if (e.key === "Escape" && rules.canReject) {
          e.stopPropagation();
          reject(turnId);
        }
      }}
    >
      <h3 className="t-title border-b border-line-soft px-3 py-2 text-ink">
        {applied ? `Applied ${plural(total)}` : `Proposed changes · ${chosen}`}
      </h3>
      {proposal.state === "pending" && (
        <p role="status" className="sr-only">
          Nilo proposes {plural(total)}. Apply them or press Escape to discard.
        </p>
      )}
      <ul className="space-y-0.5 px-1.5 py-1.5">
        {proposal.lines.map((line, i) => {
          const off = proposal.excluded.includes(i);
          const nodeId = line.nodeId;
          return (
            <li key={`${i}-${line.text}`} className="flex items-start gap-2 rounded-control px-1.5 py-1 hover:bg-sub-300">
              {rules.canToggle ? (
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={!off}
                    onChange={() => toggleOp(turnId, i)}
                    className="mt-0.5 flex-none accent-[var(--signal)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
                  />
                  <span aria-hidden className="t-meta w-3 flex-none text-center text-ink-mute">{line.glyph}</span>
                  <span className={`t-body min-w-0 flex-1 wrap-break-word ${off ? "text-ink-mute line-through" : "text-ink-dim"}`}>{line.text}</span>
                </label>
              ) : (
                <>
                  <span aria-hidden className="t-meta w-3 flex-none text-center text-ink-mute">{line.glyph}</span>
                  <span className="t-body min-w-0 flex-1 wrap-break-word text-ink-dim">{line.text}</span>
                </>
              )}
              {nodeId && (
                <button
                  type="button"
                  onClick={() => reveal(nodeId)}
                  aria-label={`Show ${line.text}`}
                  className="t-meta flex-none rounded-control px-1 text-signal-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
                >
                  Show
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {isRunning && rules.canApply && (
        <p role="status" className="t-body border-t border-line-soft px-3 py-2 text-warn-text">
          Stop the run to apply changes
        </p>
      )}
      {proposal.notice && (
        <p role="alert" className="t-body border-t border-line-soft px-3 py-2 text-warn-text">
          {proposal.notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2">
        {rules.canApply && (
          <Button ref={applyRef} variant="primary" disabled={chosen === 0 || isRunning} onClick={() => apply(turnId)}>
            Apply {plural(chosen)}
          </Button>
        )}
        {rules.canKeep && (
          <Button variant="primary" onClick={() => keep(turnId)}>
            Keep
          </Button>
        )}
        {rules.canUndo && (
          <Button onClick={() => undo(turnId)} disabled={!undoAvailable} title={undoAvailable ? undefined : "The graph changed since — use Undo (Mod+Z)"}>
            Undo
          </Button>
        )}
        {rules.canReject && <Button onClick={() => reject(turnId)}>Discard</Button>}
        {rules.pending && <Button variant="ghost" onClick={refine}>Refine</Button>}
      </div>
    </section>
  );
}
