"use client";
import { Button } from "@/components/ui/Button";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore, type Proposal } from "@/store/copilotStore";

const plural = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

/**
 * What Copilot just did, as one reversible card. The ops are already on the
 * canvas as a single undo step; Keep accepts them, Undo is only offered while
 * that step is still the head of the canvas history.
 */
export function ProposalCard({ turnId, proposal }: { turnId: string; proposal: Proposal }) {
  const keep = useCopilotStore((s) => s.keep);
  const undo = useCopilotStore((s) => s.undo);
  const setTab = useCopilotStore((s) => s.setTab);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const head = useCanvasStore((s) => s._history[s._historyIndex]?.seq);
  const { setCenter, getNode } = useReactFlow();

  const count = proposal.lines.length;
  if (proposal.state === "kept") return <p className="t-meta text-ink-mute">Kept {plural(count)}</p>;
  if (proposal.state === "undone") return <p className="t-meta text-ink-mute">Undone</p>;

  const canUndo = head === proposal.seq;
  const reveal = (nodeId: string) => {
    setSelectedNode(nodeId);
    setTab("inspector");
    const n = getNode(nodeId);
    if (n) setCenter(n.position.x + 106, n.position.y + 50, { zoom: 1, duration: 260 });
  };

  return (
    <section aria-label="Proposed changes" className="rounded-float border border-line bg-sub-200">
      <h3 className="t-title border-b border-line-soft px-3 py-2 text-ink">Proposed changes · {count}</h3>
      <ul className="space-y-0.5 px-1.5 py-1.5">
        {proposal.lines.map((line, i) => {
          const body = (
            <>
              <span aria-hidden className="t-meta w-3 flex-none text-center text-ink-mute">{line.glyph}</span>
              <span className="t-body min-w-0 flex-1 wrap-break-word text-ink-dim">{line.text}</span>
            </>
          );
          return (
            <li key={i}>
              {line.nodeId ? (
                <button
                  type="button"
                  onClick={() => reveal(line.nodeId!)}
                  className="flex w-full items-start gap-2 rounded-control px-1.5 py-1 text-left hover:bg-sub-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
                >
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-2 px-1.5 py-1">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2 border-t border-line-soft px-3 py-2">
        <Button variant="primary" onClick={() => keep(turnId)}>
          Keep
        </Button>
        <Button onClick={() => undo(turnId)} disabled={!canUndo} title={canUndo ? undefined : "The graph changed since — use Undo (Mod+Z)"}>
          Undo
        </Button>
      </div>
    </section>
  );
}
