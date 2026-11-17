"use client";
import type { NodeTypes, NodeProps } from "@xyflow/react";
import { useProviderStore } from "@/components/providers/providerStore";
import { useCanvasStore } from "@/store/canvasStore";
import { nodeProviderSummary } from "../nodeProvider";
import { BaseNode } from "./BaseNode";
import type { NodeData, NodeType } from "@/lib/types";

type Line = { spec?: (d: NodeData) => React.ReactNode; note?: (d: NodeData) => React.ReactNode };

const LINES: Record<NodeType, Line> = {
  agent: {
    note: (d) => (d.roleId ? `role ${d.roleId}` : "bind a role profile"),
  },
  gate: {
    note: (d) => (d.checklist ? String(d.checklist) : "checklist empty"),
  },
  hitl: {
    note: (d) => String(d.approvalLabel ?? "awaiting a person"),
  },
  skill: {
    note: (d) => (d.skillId ? `skill ${d.skillId}` : "name a skill id"),
  },
  mcp: {
    spec: (d) => String(d.mcpUrl || d.mcpCommand || "configure transport"),
  },
  tool: {
    spec: (d) => `${String(d.toolKind ?? "shell")} · ${String(d.adapter ?? "mock")}`,
  },
  // EXPERIMENTAL (ADR-0005, spike) — shows the evidence, never implies a
  // gate/approval outcome the way Gate/HITL's own lines do.
  decision: {
    note: (d) =>
      d.decisionResult ? "evidence attached (advisory-shadow)" : "no decision evidence yet",
  },
};

function HarnessPlate({ id, data, selected, type }: NodeProps & { type: NodeType }) {
  const line = LINES[type];
  const d = data as NodeData;
  const connections = useProviderStore(s => s.connections);
  const mode = useCanvasStore(s => s.executionMode);
  return (
    <BaseNode
      id={id}
      type={type}
      data={d}
      selected={selected}
      spec={type === "agent" || type === "skill" ? nodeProviderSummary(d, mode, connections) : line.spec?.(d)}
      note={line.note?.(d)}
    />
  );
}

const AgentPlate = (props: NodeProps) => <HarnessPlate {...props} type="agent" />;
const GatePlate = (props: NodeProps) => <HarnessPlate {...props} type="gate" />;
const HitlPlate = (props: NodeProps) => <HarnessPlate {...props} type="hitl" />;
const SkillPlate = (props: NodeProps) => <HarnessPlate {...props} type="skill" />;
const McpPlate = (props: NodeProps) => <HarnessPlate {...props} type="mcp" />;
const ToolPlate = (props: NodeProps) => <HarnessPlate {...props} type="tool" />;

export const nodeTypes: NodeTypes = {
  agent: AgentPlate,
  gate: GatePlate,
  hitl: HitlPlate,
  skill: SkillPlate,
  mcp: McpPlate,
  tool: ToolPlate,
};
