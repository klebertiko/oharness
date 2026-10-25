"use client";
import { useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position, type EdgeProps } from "@xyflow/react";
import styles from "../canvas.module.css";
import type { EdgeData, EdgeKind } from "@/lib/types";

/* ═══════════════════════════════════════════════════════════════════════════
   The wire.

   Two decisions carry this:

   1. RIGHT ANGLES, NOT CURVES. Beziers read as organic — fine for a mind map,
      wrong for a bench. Orthogonal runs with 6px corners read as routing on a
      board, they stack legibly when several wires share a corridor, and they
      make a feedback loop obvious at a glance instead of a swoosh you have to
      trace.

   2. A WIRE INHERITS ITS PORT'S MEANING. `accept` runs in muted signal,
      `reject` in fault, everything else in substrate ink. The port name rides
      the wire on a knocked-out chip, so a fork can be read without selecting
      anything or opening a panel.

   Feedback edges — anything whose target sits left of its source — are routed
   deliberately below the graph on their own corridor, drawn a hair thinner so
   the forward spine stays dominant. A harness is mostly loops; if loops are
   drawn carelessly the graph turns to spaghetti at about node six.
   ═══════════════════════════════════════════════════════════════════════════ */

const STROKE: Record<EdgeKind, string> = {
  flow: "var(--ink-faint)",
  accept: "var(--signal-deep)",
  reject: "var(--fault)",
};

const TIP: Record<EdgeKind, string> = {
  flow: "url(#oh-tip-flow)",
  accept: "url(#oh-tip-accept)",
  reject: "url(#oh-tip-reject)",
};

/** Axis-aligned polyline with rounded corners. Points must alternate H/V. */
function orthoPath(pts: [number, number][], r = 6) {
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inDx = Math.sign(cx - px);
    const inDy = Math.sign(cy - py);
    const outDx = Math.sign(nx - cx);
    const outDy = Math.sign(ny - cy);
    const rIn = Math.min(r, Math.hypot(cx - px, cy - py) / 2);
    const rOut = Math.min(r, Math.hypot(nx - cx, ny - cy) / 2);
    const rr = Math.min(rIn, rOut);
    d += ` L ${cx - inDx * rr},${cy - inDy * rr}`;
    d += ` Q ${cx},${cy} ${cx + outDx * rr},${cy + outDy * rr}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]},${last[1]}`;
  return d;
}

export function HarnessWire({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [hover, setHover] = useState(false);
  const d = (data ?? {}) as EdgeData;
  const kind: EdgeKind = d.kind ?? "flow";
  const live = Boolean(d.live);

  /* Feedback: the target is upstream of the source. Route it out, down onto a
     return corridor, back, and up into the target. */
  const feedback = targetX < sourceX - 24;

  let path: string;
  let lx: number;
  let ly: number;

  if (feedback) {
    const lane = Math.max(sourceY, targetY) + 88;
    const pts: [number, number][] = [
      [sourceX, sourceY],
      [sourceX + 24, sourceY],
      [sourceX + 24, lane],
      [targetX - 24, lane],
      [targetX - 24, targetY],
      [targetX, targetY],
    ];
    path = orthoPath(pts);
    lx = (sourceX + targetX) / 2;
    ly = lane;
  } else {
    const [p, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition: sourcePosition ?? Position.Right,
      targetPosition: targetPosition ?? Position.Left,
      borderRadius: 6,
      offset: 20,
    });
    path = p;
    lx = labelX;
    ly = labelY;
  }

  const colour = live ? "var(--signal)" : STROKE[kind];
  const active = selected || hover;
  const width = live ? 1.8 : feedback ? 1.1 : selected ? 2 : 1.35;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={live ? "url(#oh-tip-live)" : TIP[kind]}
        interactionWidth={18}
        className={live ? styles.live : undefined}
        style={{
          stroke: active && !live ? "var(--ink)" : colour,
          strokeWidth: width,
          opacity: feedback && !active && !live ? 0.82 : 1,
        }}
      />

      {d.label && (
        <EdgeLabelRenderer>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: hover only highlights the wire; the wire is selectable and focusable through React Flow */}
          <div
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            className="t-meta pointer-events-auto absolute select-none rounded-none border px-[4px] uppercase leading-[13px]"
            style={{
              transform: `translate(-50%,-50%) translate(${lx}px, ${ly}px)`,
              background: selected ? colour : "var(--sub-000)",
              borderColor: selected ? colour : `color-mix(in oklab, ${colour} 55%, var(--sub-000))`,
              color: selected ? "var(--sub-000)" : colour,
            }}
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * Wire tips. A thin open chevron, not a filled triangle — a filled arrowhead
 * at every hop turns a dense graph into a field of black darts, and direction
 * only needs to be *stated*, not shouted.
 */
export function WireTips() {
  const tip = (idName: string, colour: string) => (
    <marker
      key={idName}
      id={idName}
      viewBox="0 0 10 10"
      markerWidth="7"
      markerHeight="7"
      refX="7.5"
      refY="5"
      orient="auto-start-reverse"
      markerUnits="userSpaceOnUse"
    >
      <path
        d="M 3 1.6 L 7.4 5 L 3 8.4"
        fill="none"
        stroke={colour}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </marker>
  );
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        {tip("oh-tip-flow", "var(--ink-faint)")}
        {tip("oh-tip-accept", "var(--signal-deep)")}
        {tip("oh-tip-reject", "var(--fault)")}
        {tip("oh-tip-live", "var(--signal)")}
      </defs>
    </svg>
  );
}

export const edgeTypes = { harness: HarnessWire };
