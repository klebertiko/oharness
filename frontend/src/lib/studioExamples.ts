import { apiUrl } from "@/lib/apiBase";
import type { HarnessBundle } from "@/store/harnessSessionStore";
import { fetchDefault } from "./bundlesApi";
import { HARNESS_PRESETS } from "./templates";

/** An example that ships with the app. Opening one always makes an editable copy. */
export interface StudioExample {
  id: string;
  name: string;
  description: string;
  /** Catalog examples carry their bundle; the local example harness is built in. */
  bundle: HarnessBundle | null;
  presetId?: string;
}

/** Command-palette group for opening a bundled harness; same wording as the Studio actions bar. */
export const BUNDLED_HARNESS_COMMAND_GROUP = "Open bundled harness";

export const SAMPLE_PRESET_ID = "minimal-gate";

function sampleExample(): StudioExample | null {
  const preset = HARNESS_PRESETS.find((p) => p.id === SAMPLE_PRESET_ID);
  return preset
    ? { id: "sample:" + preset.id, name: preset.name, description: preset.description, bundle: null, presetId: preset.id }
    : null;
}

function fromCatalog(raw: unknown): StudioExample[] {
  const rows = Array.isArray(raw) ? raw : (raw as { examples?: unknown })?.examples;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const r = row as { id?: unknown; name?: unknown; description?: unknown; bundle?: HarnessBundle };
    const bundle = r?.bundle ?? (row as HarnessBundle);
    const id = typeof r?.id === "string" ? r.id : bundle?.manifest?.id;
    if (!id || !bundle?.manifest?.id) return [];
    const name = typeof r?.name === "string" ? r.name : bundle.manifest.name || id;
    const description = typeof r?.description === "string" ? r.description : bundle.manifest.description || "";
    return [{ id, name, description, bundle }];
  });
}

/**
 * Everything the app offers as a starting point: whatever the engine's examples
 * catalog returns (`GET /bundles/examples`), plus the built-in example harness. An engine
 * without the catalog falls back to the bundled Agile Harness so there is always one.
 */
export async function fetchStudioExamples(): Promise<StudioExample[]> {
  let catalog: StudioExample[] = [];
  try {
    const res = await fetch(apiUrl("/bundles/examples"), { cache: "no-store" });
    if (res.ok) catalog = fromCatalog(await res.json());
  } catch { /* offline engine: handled by the fallback below */ }
  if (catalog.length === 0) {
    try {
      const bundle = (await fetchDefault()) as unknown as HarnessBundle;
      catalog = fromCatalog([{ bundle }]);
    } catch { /* no engine: only the built-in example harness is offered */ }
  }
  const sample = sampleExample();
  if (!sample) return catalog;
  return [...catalog.slice(0, 1), sample, ...catalog.slice(1)];
}

export type StudioOrigin = "saved" | "example" | "draft";

const EXAMPLE_ID = /^oharness\.(example|default|studio\.sample)\b/;

/** Where the open harness came from: a saved file, a bundled example, or a new draft. */
export function studioOrigin(recordId: string | null, bundleId: string | null | undefined): StudioOrigin {
  if (recordId) return "saved";
  return bundleId && EXAMPLE_ID.test(bundleId) ? "example" : "draft";
}
