import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canvasNodeToBundleNode,
  canvasEdgeToBundleEdge,
  composeBundleFromCanvas,
  fetchDefault,
  fetchExample,
  fetchExamples,
  isOHarnessBundle,
  mockBundle,
  validateBundle,
  type OHarnessBundle,
} from "./bundlesApi";

const sample: OHarnessBundle = {
  schemaVersion: "1.0.0",
  manifest: {
    id: "hello",
    name: "Hello",
    version: "0.1.0",
    description: "min",
    license: "MIT",
    tags: [],
  },
  graph: { nodes: [], edges: [] },
  content: {
    prompts: {},
    agents: {},
    skills: {},
    hooks: {},
    commands: {},
    scripts: {},
  },
  runtime: { preferred: "api", cli: null, env: [], secrets: [] },
  validation: { mockProfile: "default" },
};

describe("bundlesApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchDefault GETs /bundles/default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => sample,
      })
    );

    const bundle = await fetchDefault();
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/bundles/default", { cache: "no-store" });
    expect(bundle.manifest.id).toBe("hello");
  });

  it("fetchExamples GETs /bundles/examples and returns the catalog items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          examples: [{ id: "hello", name: "Hello", description: "min", tags: [], bundle: sample }],
        }),
      })
    );

    const items = await fetchExamples();
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/bundles/examples", { cache: "no-store" });
    expect(items.map((i) => i.id)).toEqual(["hello"]);
    expect(items[0].bundle.manifest.id).toBe("hello");
  });

  it("fetchExample GETs one example by encoded id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => sample }));

    const bundle = await fetchExample("oharness.example.deepseek-harness");
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/bundles/examples/oharness.example.deepseek-harness",
      { cache: "no-store" }
    );
    expect(bundle.manifest.id).toBe("hello");
  });

  it("validateBundle POSTs /bundles/validate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, errors: [] }),
      })
    );

    const result = await validateBundle(sample);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/bundles/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sample),
    });
    expect(result.ok).toBe(true);
  });

  it("mockBundle POSTs /bundles/mock", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          steps: [{ nodeId: "a", role: "llm", status: "planned", note: "" }],
        }),
      })
    );

    const result = await mockBundle(sample);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/bundles/mock",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample),
      }
    );
    expect(result.steps).toHaveLength(1);
  });

  it("composeBundleFromCanvas overlays canvas graph on base content", () => {
    const composed = composeBundleFromCanvas(sample, {
      nodes: [{ id: "n1", type: "llm", data: { label: "Writer" } }],
      edges: [{ id: "e1", source: "n1", target: "n1" }],
      harnessMeta: { name: "Studio Draft", description: "from canvas" },
    });

    expect(composed.content).toEqual(sample.content);
    expect(composed.manifest.name).toBe("Studio Draft");
    expect(composed.graph.nodes).toMatchObject([
      { id: "n1", role: "llm", label: "Writer" },
    ]);
    expect(composed.graph.edges).toEqual([
      { id: "e1", source: "n1", target: "n1" },
    ]);
  });

  it("exports complete Agent authoring data and positions without persisting raw credentials", () => {
    const node = {
      id: "reviewer",
      type: "agent",
      position: { x: -37.5, y: 284 },
      authoring: { collapsed: true },
      data: {
        label: "Reviewer",
        providerIds: ["primary", "fallback"],
        model: "review-model",
        systemPrompt: "Review carefully.\nPreserve whitespace.\n",
        prompt: "Check the proposal.\nReturn a Signal.",
        roleId: "qa",
        emits: ["accept", "reject"],
        secretRef: "oharness/reviewer",
        apiKey: "legacy-secret-must-not-export",
        extension: { reviewer: { checks: ["tests", "accessibility"] } },
      },
    };

    expect(canvasNodeToBundleNode(node)).toEqual({
      id: "reviewer",
      type: "agent",
      role: "agent",
      label: "Reviewer",
      position: { x: -37.5, y: 284 },
      authoring: { collapsed: true },
      data: {
        label: "Reviewer",
        providerIds: ["primary", "fallback"],
        model: "review-model",
        systemPrompt: "Review carefully.\nPreserve whitespace.\n",
        prompt: "Check the proposal.\nReturn a Signal.",
        roleId: "qa",
        emits: ["accept", "reject"],
        secretRef: "oharness/reviewer",
        extension: { reviewer: { checks: ["tests", "accessibility"] } },
      },
    });
    expect(node.data.apiKey).toBe("legacy-secret-must-not-export");
  });

  it("exports edge conditions and Signals with port handles and authoring extensions", () => {
    const edge = {
      id: "review-accepted",
      source: "reviewer",
      target: "publish",
      sourceHandle: "accept",
      targetHandle: "input",
      type: "signal",
      label: "Ready for publication",
      authoring: { bend: 48 },
      data: {
        condition: "accept",
        kind: "control",
        signals: ["Ready for QA", "accept"],
        extension: { guard: { checklist: ["tests"] } },
      },
    };
    expect(canvasEdgeToBundleEdge(edge)).toEqual({
      id: "review-accepted",
      source: "reviewer",
      target: "publish",
      sourceHandle: "accept",
      targetHandle: "input",
      type: "signal",
      label: "Ready for publication",
      authoring: { bend: 48 },
      data: {
        condition: "accept",
        kind: "control",
        signals: ["Ready for QA", "accept"],
        extension: { guard: { checklist: ["tests"] } },
      },
    });
  });

  it("composes the current authoring graph while retaining base bundle and graph extensions", () => {
    const base: OHarnessBundle = {
      ...sample,
      authoring: { format: "review-v2" },
      graph: {
        nodes: [{ id: "stale-node" }],
        edges: [{ id: "stale-edge" }],
        viewport: { x: -18, y: 72, zoom: 0.75 },
        extension: { routes: ["accept", "reject"] },
      },
    };
    const composed = composeBundleFromCanvas(base, {
      nodes: [{
        id: "draft",
        type: "skill",
        position: { x: 16, y: -42 },
        data: { label: "Draft", providerIds: ["pinned"], secretRef: "oharness/draft", apiKey: "do-not-export" },
      }],
      edges: [{ id: "self", source: "draft", target: "draft", sourceHandle: "done", targetHandle: "in", data: { condition: "accept", signal: "Ready for QA" } }],
      harnessMeta: { name: "Edited harness", description: "Edited description" },
    });
    expect(composed).toEqual({
      ...sample,
      manifest: { ...sample.manifest, name: "Edited harness", description: "Edited description" },
      authoring: { format: "review-v2" },
      graph: {
        viewport: { x: -18, y: 72, zoom: 0.75 },
        extension: { routes: ["accept", "reject"] },
        nodes: [{ id: "draft", type: "skill", role: "skill", label: "Draft", position: { x: 16, y: -42 }, data: { label: "Draft", providerIds: ["pinned"], secretRef: "oharness/draft" } }],
        edges: [{ id: "self", source: "draft", target: "draft", sourceHandle: "done", targetHandle: "in", data: { condition: "accept", signal: "Ready for QA" } }],
      },
    });
    expect(base.graph.nodes).toEqual([{ id: "stale-node" }]);
  });

  it("isOHarnessBundle requires schemaVersion + manifest.id", () => {
    expect(isOHarnessBundle(sample)).toBe(true);
    expect(isOHarnessBundle({ manifest: { id: "x" } })).toBe(false);
    expect(isOHarnessBundle(null)).toBe(false);
  });
});
