import type { HarnessBundle } from "@/store/harnessSessionStore";
import type { HarnessGraph, HarnessMeta } from "./types";
import { composeBundleFromCanvas } from "./bundlesApi";

/** The picker's row for a saved harness: identity only. The graph is fetched when it is chosen. */
export function stubBundleFromMeta(meta: HarnessMeta): HarnessBundle {
  return {
    schemaVersion: "1.1.0",
    manifest: { id: meta.id, name: meta.name || meta.id, description: meta.description ?? "", updatedAt: meta.updated_at },
  };
}

/**
 * A saved harness record as the bundle the chat runs. Same composition as
 * "Use in chat" from Studio, but the manifest id is the record id so a saved
 * harness has one identity everywhere (thread binding, picker, session).
 */
export function bundleFromSavedRecord(record: HarnessMeta & { graph_json?: HarnessGraph | null }): HarnessBundle {
  const graph = record.graph_json;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("This saved harness has no graph to run.");
  }
  const bundle = composeBundleFromCanvas(null, {
    nodes: graph.nodes,
    edges: graph.edges,
    harnessMeta: { name: record.name, description: record.description ?? "" },
  });
  return {
    ...bundle,
    manifest: { ...bundle.manifest, id: record.id, tags: ["studio", "saved"], updatedAt: record.updated_at },
  } as unknown as HarnessBundle;
}
