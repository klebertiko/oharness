"use client";
import { useState } from "react";
import { Handle, Position, NodeToolbar } from "@xyflow/react";
import { Copy, Unlink, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore } from "@/store/copilotStore";
import { useHarnessActions } from "@/lib/actions";
import styles from "../canvas.module.css";
import { PORTS, portRows } from "@/lib/ports";
import { ROLE_CODE, ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import type { Mark } from "@/lib/copilot/preview";
import type { NodeData, NodeType } from "@/lib/types";

/* ═══════════════════════════════════════════════════════════════════════════
   The node plate.

   Three ideas, in order of how much they matter:

   1. PORTS ARE VISIBLE AND NAMED. Every other graph editor gives a node one
      anonymous dot per side. A harness node forks on meaning — pass/fail,
      approve/reject, match/else — so the plate carries a small ledger of
      named port rows and every wire leaves from a row you can read. A wired
      port fills solid; an unwired one stays hollow. You can audit a graph's
      connectivity without following a single wire.

   2. ROLE AND STATE USE DIFFERENT CHANNELS. Role identity is the 3px spine
      and the glyph — constant, quiet, nine hues at one lightness. Execution
      state owns the plate border and the mono slot in the header. They never
      compete, so "which one is running" stays legible in a graph of forty.

   3. SELECTION IS REGISTRATION MARKS, NOT A GLOW. Four corner brackets set
      off the plate plus one substrate value step. It survives a dark canvas,
      it never blooms, and it reads as instrumentation rather than as a
      highlighted row in a web page.
   ═══════════════════════════════════════════════════════════════════════════ */

const PLATE_W = 212;
const ROW_H = 20;

/** Border colour is the execution state. This is its only job. */
const STATE_BORDER: Record<string, string> = {
  idle: "var(--line)",
  running: "var(--signal)",
  complete: "var(--signal-deep)",
  error: "var(--fault)",
  paused: "var(--warn)",
};

const MARK_TEXT: Record<Mark, string> = { added: "+ new", changed: "~ edited", proposed: "proposed", removed: "− removal" };

/** The mono slot in the header, when there is something machine-true to say. */
export function StateSlot({ data, type, mark }: { data: NodeData; type: NodeType; mark?: Mark }) {
  const status = (data.status as string) ?? "idle";
  if (status === "running") return <span className="t-meta text-signal-text">running</span>;
  if (status === "error") return <span className="t-meta text-fault-text">error</span>;
  if (status === "paused") return <span className="t-meta text-warn-text">held</span>;
  // A pending Copilot proposal is live state: it wins over a stale "done".
  if (mark) return <span className="t-meta text-signal-text">{MARK_TEXT[mark]}</span>;
  if (status === "complete")
    return (
      <span className="t-meta text-ink-dim">
        {data.latencyMs !== undefined ? `${data.latencyMs}ms` : "done"}
      </span>
    );
  return <span className="t-meta text-ink-mute">{ROLE_CODE[type]}</span>;
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid h-6 w-6 place-items-center border-r border-line-soft text-ink-mute transition-colors last:border-r-0 hover:bg-sub-300 hover:text-ink ${
        danger ? "hover:text-fault-text" : ""
      }`}
    >
      <Icon size={12} strokeWidth={1.7} absoluteStrokeWidth />
    </button>
  );
}

export interface BaseNodeProps {
  id: string;
  type: NodeType;
  data: NodeData;
  selected?: boolean;
  /** Machine facts — mono. Adapter, model, sampling. */
  spec?: React.ReactNode;
  /** Human copy — proportional. A prompt, an approval sentence. */
  note?: React.ReactNode;
}

export function BaseNode({ id, type, data, selected, spec, note }: BaseNodeProps) {
  const [hover, setHover] = useState(false);
  const edges = useCanvasStore((s) => s.edges);
  const duplicateNode = useCanvasStore((s) => s.duplicateNode);
  const detachNode = useCanvasStore((s) => s.detachNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const awaitingHuman = useCanvasStore((s) => s.awaitingHuman);
  const mark = useCopilotStore((s) => s.marks[id]);
  const ghost = mark === "proposed";
  const { resolveHitl } = useHarnessActions();

  const Icon = ROLE_ICON[type];
  const role = ROLE_VAR[type];
  const status = (data.status as string) ?? "idle";
  const schema = PORTS[type];
  const rows = portRows(type);

  /* True only for the one HITL node the live run is actually parked on — this
     is what turns the port ledger's static "approve"/"reject" labels into
     real controls, and only for that node. */
  const isAwaitingHuman = type === "hitl" && awaitingHuman?.nodeId === id;

  const handleReject = () => {
    const rejectionNote = window.prompt("Reason for rejecting (optional):");
    if (rejectionNote === null) return; // person cancelled — leave the run parked
    resolveHitl("reject", rejectionNote.trim());
  };

  /* Which ports actually carry a wire. Cheap enough at this graph size, and it
     turns the port ledger into a connectivity report. */
  const wiredOut = new Set(edges.filter((e) => e.source === id).map((e) => e.sourceHandle ?? "out"));
  const wiredIn = new Set(edges.filter((e) => e.target === id).map((e) => e.targetHandle ?? "in"));

  /* A shorter port list is centred against the longer one, so an aggregator's
     single output sits opposite its middle input instead of hanging off row 1. */
  const inOffset = Math.floor((rows - schema.in.length) / 2);
  const outOffset = Math.floor((rows - schema.out.length) / 2);

  const output = data.output as string | undefined;
  const error = data.error as string | undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only reveals the toolbar, which a selected node also shows; React Flow owns node focus and keys
    <div
      className="relative"
      style={{ width: PLATE_W }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <NodeToolbar isVisible={!ghost && (hover || selected)} position={Position.Top} offset={9}>
        <div className="oh-float flex overflow-hidden">
          <ToolbarButton icon={Copy} label="Duplicate node" onClick={() => duplicateNode(id)} />
          <ToolbarButton icon={Unlink} label="Detach all wires" onClick={() => detachNode(id)} />
          <ToolbarButton icon={Trash2} label="Delete node" danger onClick={() => removeNode(id)} />
        </div>
      </NodeToolbar>

      {selected && <RegistrationMarks />}

      <div
        className="oh-plate relative rounded-panel transition-colors"
        style={{
          background: ghost ? "color-mix(in oklab, var(--signal) 14%, var(--sub-100))" : selected ? "var(--sub-200)" : "var(--sub-100)",
          opacity: mark === "removed" ? 0.55 : undefined,
          border: `1px ${ghost ? "dashed" : "solid"} ${
            ghost
              ? "var(--signal)"
              : status === "idle" && (selected || hover)
              ? selected
                ? "var(--signal)"
                : "var(--ink-faint)"
              : STATE_BORDER[status] ?? "var(--line)"
          }`,
        }}
      >
        {/* Role spine — constant, never state. */}
        <span
          aria-hidden
          className="absolute inset-y-[2px] left-0 w-[3px] rounded-none"
          style={{ background: role }}
        />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex h-[26px] items-center gap-2 pl-[11px] pr-2">
          <span
            aria-hidden
            className="grid h-[16px] w-[16px] flex-none place-items-center rounded-none"
            style={{
              background: "color-mix(in oklab, var(--role-c) 16%, var(--sub-200))",
              ["--role-c" as string]: role,
              color: role,
            }}
          >
            <Icon size={10} strokeWidth={1.9} absoluteStrokeWidth />
          </span>
          <span className="t-title min-w-0 flex-1 truncate text-ink">{data.label as string}</span>
          <StateSlot data={data} type={type} mark={mark} />
        </div>

        {/* ── Spec / note — machine facts in mono, human copy in prose ────── */}
        {spec && (
          <div title={typeof spec === "string" ? spec : undefined} className="t-meta truncate border-t border-line-soft py-[4px] pl-[11px] pr-2 text-ink-mute">
            {spec}
          </div>
        )}
        {(isAwaitingHuman ? awaitingHuman?.question : note) && (
          <div className="t-body truncate border-t border-line-soft py-[4px] pl-[11px] pr-2 text-ink-mute">
            {isAwaitingHuman ? awaitingHuman?.question : note}
          </div>
        )}

        {isAwaitingHuman && awaitingHuman?.context && (
          <details className="border-t border-line-soft px-[11px] py-[4px]">
            <summary className="t-meta cursor-pointer text-ink-mute hover:text-ink-dim">
              show what it is asking you to approve
            </summary>
            <p className="t-body mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-ink-mute">
              {awaitingHuman.context}
            </p>
          </details>
        )}

        {/* ── Port ledger ────────────────────────────────────────────────── */}
        <div className="border-t border-line-soft">
          {Array.from({ length: rows }).map((_, r) => {
            const pin = schema.in[r - inOffset];
            const pout = schema.out[r - outOffset];
            return (
              <div
                key={r}
                className="relative flex items-center justify-between pl-[11px] pr-2"
                style={{ height: ROW_H }}
              >
                {pin ? (
                  <>
                    <Handle
                      type="target"
                      id={pin.id}
                      position={Position.Left}
                      className={wiredIn.has(pin.id) ? styles.portWired : undefined}
                      style={{ ["--port-tone" as string]: role }}
                    />
                    <span className="t-meta truncate text-ink-mute">{pin.label}</span>
                  </>
                ) : (
                  <span />
                )}
                {pout ? (
                  <>
                    {isAwaitingHuman && (pout.id === "approve" || pout.id === "reject") ? (
                      <button
                        type="button"
                        onClick={() =>
                          pout.id === "approve" ? resolveHitl("approve", "") : handleReject()
                        }
                        aria-label={
                          pout.id === "approve"
                            ? "Approve this step and continue the run"
                            : "Reject this step and end the run"
                        }
                        className="oh-focus-inner t-meta truncate rounded-none underline decoration-dotted underline-offset-2"
                        style={{
                          color: pout.tone === "accept" ? "var(--signal-text)" : "var(--fault-text)",
                        }}
                      >
                        {pout.label}
                      </button>
                    ) : (
                      <span
                        className="t-meta truncate"
                        style={{
                          color:
                            pout.tone === "accept"
                              ? "var(--signal-text)"
                              : pout.tone === "reject"
                                ? "var(--fault-text)"
                                : "var(--ink-mute)",
                        }}
                      >
                        {pout.label}
                      </span>
                    )}
                    <Handle
                      type="source"
                      id={pout.id}
                      position={Position.Right}
                      className={wiredOut.has(pout.id) ? styles.portWired : undefined}
                      style={{
                        ["--port-tone" as string]:
                          pout.tone === "accept"
                            ? "var(--signal-deep)"
                            : pout.tone === "reject"
                              ? "var(--fault)"
                              : role,
                      }}
                    />
                  </>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Run residue — only ever shown after a real run ──────────────── */}
        {output && status === "complete" && (
          <div className="t-meta line-clamp-2 break-all rounded-b-panel border-t border-line-soft bg-sub-200 py-[5px] pl-[11px] pr-2 text-ink-dim">
            {output.slice(0, 110)}
            {output.length > 110 ? "…" : ""}
          </div>
        )}
        {error && (
          <div className="t-meta line-clamp-2 rounded-b-panel border-t border-line-soft py-[5px] pl-[11px] pr-2 text-fault-text">
            {error}
          </div>
        )}

        {/* Throughput tick. Clipped to a 1px strip so nothing escapes a plate
            that otherwise has to let its ports hang outside. */}
        {status === "running" && (
          <span className="oh-running absolute inset-x-0 bottom-0 block h-px overflow-hidden" />
        )}
      </div>
    </div>
  );
}

/** Four corner brackets, offset off the plate. Selection, no glow. */
function RegistrationMarks() {
  const base = "pointer-events-none absolute h-[8px] w-[8px] border-signal";
  return (
    <>
      <span aria-hidden className={`${base} left-[-5px] top-[-5px] border-l border-t`} />
      <span aria-hidden className={`${base} right-[-5px] top-[-5px] border-r border-t`} />
      <span aria-hidden className={`${base} bottom-[-5px] left-[-5px] border-b border-l`} />
      <span aria-hidden className={`${base} bottom-[-5px] right-[-5px] border-b border-r`} />
    </>
  );
}
