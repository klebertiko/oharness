/**
 * Graph-edit ops: validate (golden-parity with backend/studio_copilot/ops.py),
 * materialise onto the canvas with deterministic layout, describe, and mark.
 *
 * The client re-validates against the *live* canvas because it can change
 * while a request is in flight; a failing list is never partly applied.
 */
import { edgeForConnection, sameWire } from "../edges";
import { PORTS, findPort } from "../ports";
import { NODE_TEMPLATES } from "../templates";
import { NILO_FORBIDDEN_FIELDS, OP_RULES } from "./rules";
import type { HarnessEdge, HarnessNode, NodeData, NodeType } from "../types";
import { EDITABLE, LIMITS, catalogPorts, isCatalogType, type CatalogType } from "./catalog";
import type { CopilotConfig, CopilotErrorCode, CopilotGraph, CopilotNode, Op, ValidationResult } from "./contract";

/** Code points, to match Python's `len` on the backend. */
const len = (s: string) => Array.from(s).length;

const REF_RE = /^n[0-9]{1,3}$/;
const ID_FIELD_RE = /^[A-Za-z0-9_.-]{0,40}$/;

const SHAPES = Object.fromEntries(Object.entries(OP_RULES).map(([name, rule]) => [name, rule.shape]));

class Fail extends Error {
  constructor(
    readonly code: CopilotErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkShape(op: Record<string, unknown>, name: string) {
  const shape = SHAPES[name];
  const missing = shape.required.filter((k) => !(k in op));
  if (missing.length) throw new Fail("field_invalid", `${name} is missing ${missing.join(", ")}`);
  const extra = Object.keys(op).filter((k) => !shape.required.includes(k) && !shape.optional.includes(k));
  if (extra.length) throw new Fail("field_invalid", `${name} has unexpected field ${extra.join(", ")}`);
  for (const [key, expected] of Object.entries(shape.types)) {
    if (!(key in op)) continue;
    const v = op[key];
    const ok = expected === "string" ? typeof v === "string" : isPlainObject(v);
    if (!ok) throw new Fail("field_invalid", `${name}.${key} must be a ${expected === "string" ? "string" : "object"}`);
  }
}

class Working {
  nodes: CopilotNode[];
  edges: CopilotGraph["edges"];
  refs = new Map<string, string>();
  usedRefs = new Set<string>();

  constructor(graph: CopilotGraph) {
    this.nodes = structuredClone(graph.nodes);
    this.edges = structuredClone(graph.edges);
  }

  find(id: string): CopilotNode | undefined {
    // `ref:<ref>` is the validator's private spelling of a new node; an op may
    // only reach it through its ref, or validating and applying would disagree.
    if (id.startsWith("ref:")) return undefined;
    const direct = this.nodes.find((n) => n.id === id);
    if (direct) return direct;
    const synthetic = this.refs.get(id);
    return synthetic ? this.nodes.find((n) => n.id === synthetic) : undefined;
  }

  need(id: string, role = "node"): CopilotNode {
    const node = this.find(id);
    if (!node) throw new Fail("unknown_node", `Unknown ${role} "${id}"`);
    return node;
  }
}

function checkLabel(label: string): string {
  const trimmed = label.trim();
  if (len(trimmed) < 1 || len(trimmed) > LIMITS.labelMax) throw new Fail("field_invalid", `label must be 1–${LIMITS.labelMax} characters`);
  return trimmed;
}

function checkConfig(type: string, config: Record<string, unknown>) {
  const editable = isCatalogType(type) ? EDITABLE[type] : [];
  for (const key of Object.keys(config)) {
    if ((NILO_FORBIDDEN_FIELDS as readonly string[]).includes(key) || !editable.includes(key)) throw new Fail("field_not_editable", `"${key}" cannot be set on a ${type}`);
  }
  for (const [key, value] of Object.entries(config)) {
    if (key === "roleId" || key === "skillId" || key === "gateId") {
      if (typeof value !== "string" || !ID_FIELD_RE.test(value) || len(value) > LIMITS.idFieldMax) {
        throw new Fail("field_invalid", `${key} must be up to ${LIMITS.idFieldMax} letters, digits, _ . or -`);
      }
    } else if (key === "systemPrompt" || key === "checklist" || key === "approvalLabel") {
      const limit = key === "systemPrompt" ? LIMITS.systemPromptMax : key === "checklist" ? LIMITS.checklistMax : LIMITS.approvalLabelMax;
      if (typeof value !== "string" || len(value) > limit) throw new Fail("field_invalid", `${key} must be text up to ${limit} characters`);
    } else if (key === "emits" || key === "consumes") {
      const ok =
        Array.isArray(value) &&
        value.length <= LIMITS.signalListMax &&
        value.every((s) => typeof s === "string" && len(s) >= 1 && len(s) <= LIMITS.signalMax);
      if (!ok) throw new Fail("field_invalid", `${key} must be up to ${LIMITS.signalListMax} signals of 1–${LIMITS.signalMax} characters`);
    }
  }
}

function pickPort(node: CopilotNode, side: "in" | "out", requested: string | undefined): string {
  const ports = catalogPorts(node.type, side);
  if (requested === undefined) {
    if (!ports.length) throw new Fail("bad_port", `${node.label} has no ${side} port`);
    return ports[0];
  }
  if (!ports.includes(requested)) throw new Fail("bad_port", `${node.label} has no ${side} port "${requested}"`);
  return requested;
}

const edgeKey = (e: { source: string; sourceHandle: string; target: string; targetHandle: string }) =>
  [e.source, e.sourceHandle, e.target, e.targetHandle].join("\u0000");

function addNodeOp(w: Working, op: Record<string, unknown>) {
  const ref = op.ref as string;
  if (!REF_RE.test(ref) || w.usedRefs.has(ref) || w.nodes.some((n) => n.id === ref || n.id === `ref:${ref}`)) {
    throw new Fail("bad_ref", `ref "${ref}" must look like n1, n2, … and be unused`);
  }
  const type = op.type as string;
  if (!isCatalogType(type)) throw new Fail("unknown_type", `Unknown node type "${type}"`);
  const label = checkLabel(op.label as string);
  const config = (op.config ?? {}) as Record<string, unknown>;
  checkConfig(type, config);
  if (op.near !== undefined) w.need(op.near as string, "near node");
  if (w.nodes.length + 1 > LIMITS.maxNodes) throw new Fail("graph_limit", `A graph holds at most ${LIMITS.maxNodes} nodes`);
  const id = `ref:${ref}`;
  w.refs.set(ref, id);
  w.usedRefs.add(ref);
  w.nodes.push({ id, type, label, config: structuredClone(config) as CopilotConfig });
}

function updateNodeOp(w: Working, op: Record<string, unknown>) {
  const node = w.need(op.id as string);
  const config = (op.config ?? {}) as Record<string, unknown>;
  if (op.label === undefined && Object.keys(config).length === 0) {
    throw new Fail("empty_update", "updateNode needs a label or at least one config field");
  }
  const label = op.label !== undefined ? checkLabel(op.label as string) : undefined;
  checkConfig(node.type, config);
  if (label !== undefined) node.label = label;
  node.config = { ...node.config, ...(structuredClone(config) as CopilotConfig) };
}

function removeNodeOp(w: Working, op: Record<string, unknown>) {
  const node = w.need(op.id as string);
  w.nodes = w.nodes.filter((n) => n !== node);
  w.edges = w.edges.filter((e) => e.source !== node.id && e.target !== node.id);
  for (const [ref, id] of w.refs) if (id === node.id) w.refs.delete(ref);
}

function connectOp(w: Working, op: Record<string, unknown>) {
  const src = w.need(op.from as string, "source node");
  const dst = w.need(op.to as string, "target node");
  if (src === dst) throw new Fail("self_loop", `${src.label} cannot connect to itself`);
  const sourceHandle = pickPort(src, "out", op.fromPort as string | undefined);
  if (!catalogPorts(dst.type, "in").length) throw new Fail("no_input_port", `${dst.label} has no input port`);
  const targetHandle = pickPort(dst, "in", op.toPort as string | undefined);
  const edge = { source: src.id, sourceHandle, target: dst.id, targetHandle };
  if (w.edges.some((e) => edgeKey(e) === edgeKey(edge))) throw new Fail("duplicate_edge", `${src.label} → ${dst.label} is already connected`);
  if (w.edges.length + 1 > LIMITS.maxEdges) throw new Fail("graph_limit", `A graph holds at most ${LIMITS.maxEdges} edges`);
  w.edges.push(edge);
}

function disconnectOp(w: Working, op: Record<string, unknown>) {
  const src = w.need(op.from as string, "source node");
  const dst = w.need(op.to as string, "target node");
  const edge = {
    source: src.id,
    sourceHandle: pickPort(src, "out", op.fromPort as string | undefined),
    target: dst.id,
    targetHandle: pickPort(dst, "in", op.toPort as string | undefined),
  };
  const keep = w.edges.filter((e) => edgeKey(e) !== edgeKey(edge));
  if (keep.length === w.edges.length) throw new Fail("edge_not_found", `${src.label} → ${dst.label} is not connected`);
  w.edges = keep;
}

const HANDLERS: Record<string, (w: Working, op: Record<string, unknown>) => void> = {
  addNode: addNodeOp,
  updateNode: updateNodeOp,
  removeNode: removeNodeOp,
  connect: connectOp,
  disconnect: disconnectOp,
};

export function validateOps(graph: CopilotGraph, ops: unknown[]): ValidationResult {
  if (ops.length > LIMITS.maxOps) {
    return { ok: false, errors: [{ index: LIMITS.maxOps, code: "too_many_ops", message: `At most ${LIMITS.maxOps} changes per proposal` }] };
  }
  const work = new Working(graph);
  for (const [index, op] of ops.entries()) {
    try {
      const name = isPlainObject(op) ? op.op : undefined;
      if (typeof name !== "string" || !Object.hasOwn(SHAPES, name)) {
        throw new Fail("unknown_op", typeof name === "string" ? `Unknown change "${name}"` : "Each change must be an object with an op");
      }
      checkShape(op as Record<string, unknown>, name);
      HANDLERS[name](work, op as Record<string, unknown>);
    } catch (err) {
      if (err instanceof Fail) return { ok: false, errors: [{ index, code: err.code, message: err.message }] };
      throw err;
    }
  }
  return { ok: true, graph: { nodes: work.nodes, edges: work.edges } };
}

/* ── materialise ─────────────────────────────────────────────────────────── */

const COL = 280;
const ROW = 120;
const SKILL_DROP = 160;
const NEAR = 40;

const defaultNewId = () => crypto.randomUUID().slice(0, 8);

const isConnectionPiece = (type: NodeType) => type === "skill" || type === "mcp" || type === "tool";

function place(nodes: HarnessNode[], anchor: { x: number; y: number } | undefined, type: NodeType) {
  let x: number;
  let y: number;
  if (anchor) {
    x = isConnectionPiece(type) ? anchor.x : anchor.x + COL;
    y = isConnectionPiece(type) ? anchor.y + SKILL_DROP : anchor.y;
  } else if (nodes.length === 0) {
    x = 0;
    y = 0;
  } else {
    x = Math.max(...nodes.map((n) => n.position.x)) + COL;
    y = Math.min(...nodes.map((n) => n.position.y));
  }
  while (nodes.some((n) => Math.abs(n.position.x - x) < NEAR && Math.abs(n.position.y - y) < NEAR)) y += ROW;
  return { x, y };
}

/** Assumes `ops` already passed `validateOps` against these nodes and edges. */
export function materializeOps(
  nodes: HarnessNode[],
  edges: HarnessEdge[],
  ops: Op[],
  opts: { newId?: () => string } = {},
): { nodes: HarnessNode[]; edges: HarnessEdge[]; refToId: Record<string, string> } {
  const newId = opts.newId ?? defaultNewId;
  let outNodes = nodes.map((n) => ({ ...n, position: { ...n.position }, data: { ...n.data } }));
  let outEdges = edges.map((e) => ({ ...e }));
  const refs = new Map<string, string>();
  const resolve = (id: string) => refs.get(id) ?? id;
  const positionOf = (id: string | undefined) => {
    if (id === undefined) return undefined;
    return outNodes.find((n) => n.id === resolve(id))?.position;
  };

  const anchorFor = (op: Extract<Op, { op: "addNode" }>) => {
    const near = positionOf(op.near);
    if (near) return near;
    const connects = ops.filter((o): o is Extract<Op, { op: "connect" }> => o.op === "connect");
    const candidates = isConnectionPiece(op.type)
      ? connects.filter((c) => c.from === op.ref).map((c) => c.to)
      : connects.filter((c) => c.to === op.ref).map((c) => c.from);
    for (const id of candidates) {
      const p = positionOf(id);
      if (p) return p;
    }
    return undefined;
  };

  for (const op of ops) {
    if (op.op === "addNode") {
      const template = NODE_TEMPLATES.find((t) => t.type === op.type)!;
      const id = `${op.type}-${newId()}`;
      refs.set(op.ref, id);
      outNodes.push({
        id,
        type: op.type,
        position: place(outNodes, anchorFor(op), op.type),
        data: { ...structuredClone(template.defaultData), ...structuredClone(op.config ?? {}), label: op.label.trim() } as NodeData,
      });
    } else if (op.op === "updateNode") {
      const id = resolve(op.id);
      outNodes = outNodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...structuredClone(op.config ?? {}), ...(op.label !== undefined ? { label: op.label.trim() } : {}) } } : n,
      );
    } else if (op.op === "removeNode") {
      const id = resolve(op.id);
      outNodes = outNodes.filter((n) => n.id !== id);
      outEdges = outEdges.filter((e) => e.source !== id && e.target !== id);
    } else {
      const source = outNodes.find((n) => n.id === resolve(op.from));
      const target = outNodes.find((n) => n.id === resolve(op.to));
      if (!source || !target) continue;
      const sourceHandle = findPort(source.type, "out", op.fromPort)?.id ?? "out";
      const targetHandle = findPort(target.type, "in", op.toPort)?.id ?? "in";
      if (op.op === "connect") {
        const edge = edgeForConnection(source, { source: source.id, target: target.id, sourceHandle, targetHandle });
        if (!outEdges.some((e) => sameWire(e, edge, outNodes))) outEdges.push(edge);
      } else {
        outEdges = outEdges.filter(
          (e) =>
            !(
              e.source === source.id &&
              e.target === target.id &&
              (e.sourceHandle ?? findPort(source.type, "out")?.id) === sourceHandle &&
              (e.targetHandle ?? findPort(target.type, "in")?.id) === targetHandle
            ),
        );
      }
    }
  }
  return { nodes: outNodes, edges: outEdges, refToId: Object.fromEntries(refs) };
}

/* ── describe & mark ─────────────────────────────────────────────────────── */

export interface OpLine {
  glyph: "+" | "~" | "−" | "→" | "×";
  text: string;
  nodeId?: string;
}

const typeLabel = (type: string) => NODE_TEMPLATES.find((t) => t.type === type)?.label ?? type;

export function describeOps(ops: Op[], graph: CopilotGraph): OpLine[] {
  const known = new Map<string, { label: string; type: string }>(graph.nodes.map((n) => [n.id, { label: n.label, type: n.type }]));
  const label = (id: string) => known.get(id)?.label ?? id;
  const wire = (from: string, fromPort: string | undefined, to: string) => {
    const src = known.get(from);
    const multi = src && isCatalogType(src.type) && PORTS[src.type as CatalogType].out.length > 1;
    const port = multi ? ` ${fromPort ?? PORTS[src.type as CatalogType].out[0].id}` : "";
    return `${label(from)}${port} → ${label(to)}`;
  };

  const lines: OpLine[] = [];
  for (const op of ops) {
    if (op.op === "addNode") {
      known.set(op.ref, { label: op.label.trim(), type: op.type });
      lines.push({ glyph: OP_RULES.addNode.glyph, text: `${typeLabel(op.type)} "${op.label.trim()}"` });
    } else if (op.op === "updateNode") {
      const parts = [...(op.label !== undefined ? [`renamed "${op.label.trim()}"`] : []), ...Object.keys(op.config ?? {})];
      lines.push({ glyph: OP_RULES.updateNode.glyph, text: `${label(op.id)} · ${parts.join(", ")}`, nodeId: graph.nodes.some((n) => n.id === op.id) ? op.id : undefined });
    } else if (op.op === "removeNode") {
      lines.push({ glyph: OP_RULES.removeNode.glyph, text: `${typeLabel(known.get(op.id)?.type ?? "")} "${label(op.id)}"` });
    } else if (op.op === "connect") {
      lines.push({ glyph: OP_RULES.connect.glyph, text: wire(op.from, op.fromPort, op.to) });
    } else {
      lines.push({ glyph: OP_RULES.disconnect.glyph, text: wire(op.from, op.fromPort, op.to) });
    }
  }
  return lines;
}

export function diffMarks(before: HarnessNode[], after: HarnessNode[]): Record<string, "added" | "changed"> {
  const prior = new Map(before.map((n) => [n.id, n]));
  const marks: Record<string, "added" | "changed"> = {};
  for (const node of after) {
    const old = prior.get(node.id);
    if (!old) {
      marks[node.id] = "added";
      continue;
    }
    const keys = isCatalogType(node.type) ? EDITABLE[node.type] : [];
    const differs =
      old.data.label !== node.data.label || keys.some((k) => JSON.stringify(old.data[k]) !== JSON.stringify(node.data[k]));
    if (differs) marks[node.id] = "changed";
  }
  return marks;
}
