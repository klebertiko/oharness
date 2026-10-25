/**
 * Bundle API client — FastAPI sidecar via `apiBase` (static export / Tauri).
 */

import { apiUrl } from "@/lib/apiBase";

export interface OHarnessManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  tags: string[];
}

export interface OHarnessGraph {
  [key: string]: unknown;
  nodes: unknown[];
  edges: unknown[];
}

export interface OHarnessContent {
  prompts: Record<string, unknown>;
  agents: Record<string, unknown>;
  skills: Record<string, unknown>;
  hooks: Record<string, unknown>;
  commands: Record<string, unknown>;
  scripts: Record<string, unknown>;
}

export interface OHarnessBundle {
  [key: string]: unknown;
  schemaVersion: string;
  manifest: OHarnessManifest;
  graph: OHarnessGraph;
  content: OHarnessContent;
  runtime: {
    preferred: string;
    cli: string | null;
    env: unknown[];
    secrets: unknown[];
  };
  validation: { mockProfile: string };
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
}

export interface MockStep {
  nodeId: string;
  role: string;
  status: string;
  note: string;
}

export interface MockResult {
  ok: boolean;
  steps: MockStep[];
  errors?: string[];
}

const EMPTY_CONTENT: OHarnessContent = {
  prompts: {},
  agents: {},
  skills: {},
  hooks: {},
  commands: {},
  scripts: {},
};

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error((await res.text()).slice(0, 240) || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchDefault(): Promise<OHarnessBundle> {
  const res = await fetch(apiUrl("/bundles/default"), { cache: "no-store" });
  return readJson<OHarnessBundle>(res);
}

/** One bundled example harness, as listed by `GET /bundles/examples`. */
export interface ExampleHarness {
  id: string;
  name: string;
  description: string;
  tags: string[];
  bundle: OHarnessBundle;
}

export async function fetchExamples(): Promise<ExampleHarness[]> {
  const res = await fetch(apiUrl("/bundles/examples"), { cache: "no-store" });
  return (await readJson<{ examples: ExampleHarness[] }>(res)).examples;
}

export async function fetchExample(id: string): Promise<OHarnessBundle> {
  const res = await fetch(apiUrl(`/bundles/examples/${encodeURIComponent(id)}`), { cache: "no-store" });
  return readJson<OHarnessBundle>(res);
}

export async function validateBundle(bundle: unknown): Promise<ValidateResult> {
  const res = await fetch(apiUrl("/bundles/validate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
  return readJson<ValidateResult>(res);
}

export async function mockBundle(bundle: unknown): Promise<MockResult> {
  const res = await fetch(apiUrl("/bundles/mock"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
  return readJson<MockResult>(res);
}

/** Canvas / xyflow node → schema-tolerant graph node (role from type). */
export function canvasNodeToBundleNode<T extends {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: { label?: string; [key: string]: unknown };
  role?: unknown;
  label?: unknown;
}>(node: T): Record<string, unknown> {
  const data = node.data ? { ...node.data } : undefined;
  // Legacy raw credentials are not authoring data; persist secretRef instead.
  if (data) delete data.apiKey;
  return {
    ...node,
    role: node.role ?? node.type ?? node.id,
    label: node.data?.label ?? node.label ?? node.id,
    ...(data ? { data } : {}),
  };
}

export function canvasEdgeToBundleEdge<T extends {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: Record<string, unknown>;
}>(edge: T): Record<string, unknown> {
  return { ...edge };
}

/**
 * Compose an exportable `.ohm` (OHarness Model) from the live canvas graph
 * plus content / runtime stubs taken from a base bundle.
 */
export function composeBundleFromCanvas<
  N extends Parameters<typeof canvasNodeToBundleNode>[0],
  E extends Parameters<typeof canvasEdgeToBundleEdge>[0],
>(
  base: OHarnessBundle | null,
  canvas: {
    nodes: N[];
    edges: E[];
    harnessMeta: { name: string; description: string };
  }
): OHarnessBundle {
  const fallback: OHarnessBundle = {
    schemaVersion: "1.1.0",
    manifest: {
      id: "oharness.studio.export",
      name: canvas.harnessMeta.name || "Untitled Harness",
      version: "0.1.0",
      description: canvas.harnessMeta.description || "",
      license: "MIT",
      tags: ["studio"],
    },
    graph: { nodes: [], edges: [] },
    content: { ...EMPTY_CONTENT },
    runtime: { preferred: "api", cli: null, env: [], secrets: [] },
    validation: { mockProfile: "default" },
  };

  const src = base ?? fallback;
  return {
    ...src,
    schemaVersion: src.schemaVersion || "1.0.0",
    manifest: {
      ...src.manifest,
      name: canvas.harnessMeta.name || src.manifest.name,
      description: canvas.harnessMeta.description || src.manifest.description,
    },
    graph: {
      ...src.graph,
      nodes: canvas.nodes.map(canvasNodeToBundleNode),
      edges: canvas.edges.map(canvasEdgeToBundleEdge),
    },
    content: src.content ?? { ...EMPTY_CONTENT },
    runtime: src.runtime ?? fallback.runtime,
    validation: src.validation ?? fallback.validation,
  };
}

export function serializeBundle(bundle: OHarnessBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function downloadOHarness(bundle: OHarnessBundle, filename?: string): void {
  const name =
    filename ??
    `${(bundle.manifest.name || "harness").replace(/\s+/g, "_")}.ohm`;
  const blob = new Blob([serializeBundle(bundle)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    name.endsWith(".ohm") || name.endsWith(".oharness") ? name : `${name}.ohm`;
  a.click();
  URL.revokeObjectURL(url);
}

export function isOHarnessBundle(value: unknown): value is OHarnessBundle {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const manifest = v.manifest as Record<string, unknown> | undefined;
  return typeof manifest?.id === "string" && typeof v.schemaVersion === "string";
}
