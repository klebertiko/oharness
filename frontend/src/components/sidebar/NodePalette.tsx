"use client";
import { GripVertical } from "lucide-react";
import { NODE_TEMPLATES } from "@/lib/templates";
import { ROLE_ICON } from "@/lib/roles";
import { useCanvasStore } from "@/store/canvasStore";
import styles from "@/components/canvas/canvas.module.css";
import { PORTS } from "@/lib/ports";
import { Panel } from "@/components/shell/Panel";
import type { NodeTemplate, NodeType } from "@/lib/types";

/* ═══════════════════════════════════════════════════════════════════════════
   The palette.

   Two changes carry it. First, the nine types are grouped into the four stages
   a harness has — boundary, compute, control, state — with a one-line gloss
   per group, so the panel teaches the model instead of just listing parts.
   Second, every row wears the same 3px role spine and glyph chip as the plate
   it produces, and states its port shape in mono. Dragging a row should feel
   like dragging the thing itself, not like picking from a menu.
   ═══════════════════════════════════════════════════════════════════════════ */

/** "1 in · 2 out" — the fact that decides whether a node can go where you want. */
function portShape(type: NodeType) {
  const { in: i, out: o } = PORTS[type];
  return `${i.length} in · ${o.length} out`;
}

function TemplateRow({ template }: { template: NodeTemplate }) {
  const type = template.type as NodeType;
  const Icon = ROLE_ICON[type];
  const add = () => {
    const store = useCanvasStore.getState();
    const anchor = store.nodes.find((node) => node.id === store.selectedNodeId)
      ?? store.nodes.at(-1);
    const id = `${type}-${crypto.randomUUID()}`;
    store.addNode({
      id,
      type,
      position: anchor
        ? { x: anchor.position.x + 260, y: anchor.position.y }
        : { x: 0, y: 0 },
      data: { label: template.label, ...structuredClone(template.defaultData) },
    });
    store.setSelectedNode(id);
  };

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/harness-node", JSON.stringify(template));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <button
      type="button"
      draggable
      aria-label={`Add ${template.label}`}
      onClick={add}
      onDragStart={onDragStart}
      title={`Click or drag to add — ${template.description}`}
      className={`${styles.paletteRow} group relative flex min-h-11 w-full items-center gap-2 rounded-control px-2 text-left transition-colors hover:bg-sub-200`}
    >
      <span
        aria-hidden
        data-role={type}
        className={`${styles.roleMarker} grid h-6 w-6 flex-none place-items-center rounded-control`}
      >
        <Icon size={12} strokeWidth={1.8} absoluteStrokeWidth />
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="t-title truncate text-ink-dim group-hover:text-ink">{template.label}</span>
        <span className="t-meta truncate text-ink-mute">{portShape(type)}</span>
      </span>

      <GripVertical
        size={12}
        strokeWidth={1.6}
        absoluteStrokeWidth
        aria-hidden
        className="flex-none text-ink-mute opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

export function NodePalette() {
  return (
    <Panel title="Blocks" meta="click or drag" className="h-full">
      <p className="px-2 pb-2 pt-1 text-body text-ink-mute">
        Add a block, then connect its named ports.
      </p>
      <div className="space-y-0.5 px-1">
        {NODE_TEMPLATES.map((template) => (
          <TemplateRow key={template.type} template={template} />
        ))}
      </div>
    </Panel>
  );
}
