import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore } from "@/store/copilotStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";
import { bundleGraphToCanvas } from "./bundleGraph";
import { composeBundleFromCanvas, fetchDefault, isOHarnessBundle, validateBundle } from "./bundlesApi";
import { replaceStudioCanvas } from "./studioDocuments";
import { HARNESS_PRESETS } from "./templates";

export function openStudioBundle(bundle: HarnessBundle): void {
  if (useCanvasStore.getState().isRunning) throw new Error("Stop the current run before opening another harness.");
  if (!bundle.manifest?.id || !Array.isArray(bundle.graph?.nodes) || !Array.isArray(bundle.graph?.edges)) {
    throw new Error("This harness has no editable graph.");
  }
  // Convert before replacing the draft so an invalid graph cannot erase it.
  const copy = structuredClone(bundle);
  const { nodes, edges } = bundleGraphToCanvas(copy.graph!);
  // Opening is not editing: pending edits of the open harness are saved
  // first, and nothing new is saved until the person changes it.
  replaceStudioCanvas(() => {
    useHarnessSessionStore.getState().replaceBundle(copy);
    const canvas = useCanvasStore.getState();
    canvas.loadGraph(nodes, edges);
    // A transcript and its badges belong to the harness they were asked about.
    useCopilotStore.getState().reset();
    // A bundle identifier is not a saved harness record in the local database.
    canvas.setHarnessMeta({ id: null, name: copy.manifest.name || copy.manifest.id, description: copy.manifest.description || "" });
  });
  useShellStore.getState().setSection("studio");
  useShellStore.getState().setStudioView("editor");
}

export async function openBundledHarness(signal?: AbortSignal): Promise<void> {
  const bundle = await fetchDefault();
  if (!signal?.aborted) openStudioBundle(bundle as unknown as HarnessBundle);
}

export function openStudioPreset(preset: (typeof HARNESS_PRESETS)[number]): void {
  const bundle = composeBundleFromCanvas(null, {
    nodes: [], edges: [], harnessMeta: { name: preset.name, description: preset.description },
  });
  bundle.manifest.id = "oharness.studio.sample." + preset.id;
  bundle.graph = structuredClone(preset.graph);
  openStudioBundle(bundle as unknown as HarnessBundle);
  useCanvasStore.getState().setExecutionMode("mock");
}

export function newStudioHarness(): void {
  const bundle = composeBundleFromCanvas(null, {
    nodes: [], edges: [], harnessMeta: { name: "Untitled harness", description: "" },
  });
  openStudioBundle(bundle as unknown as HarnessBundle);
  useCanvasStore.getState().setExecutionMode("mock");
}

/** The open canvas as an exportable bundle (content and runtime kept from the active one). */
export function composeStudioBundle() {
  const session = useHarnessSessionStore.getState();
  const { nodes, edges, harnessMeta } = useCanvasStore.getState();
  const base = isOHarnessBundle(session.activeBundle) ? session.activeBundle : null;
  return composeBundleFromCanvas(base, { nodes, edges, harnessMeta });
}

/** Open a bundle file's text as a new harness. Nothing changes unless it validates. */
export async function importOhmText(text: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  try {
    const parsed: unknown = JSON.parse(text);
    const result = await validateBundle(parsed);
    if (!result.ok) return { ok: false, error: result.errors?.[0] || "Import failed validation" };
    if (!isOHarnessBundle(parsed)) return { ok: false, error: "Not a recognizable .ohm bundle" };
    openStudioBundle(parsed as unknown as HarnessBundle);
    return { ok: true, name: parsed.manifest.name || parsed.manifest.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Import failed" };
  }
}

/** Open a bundled example as an editable copy; the original is never written. */
export function openStudioExample(example: { bundle: HarnessBundle | null; presetId?: string }): void {
  if (example.presetId) {
    const preset = HARNESS_PRESETS.find((p) => p.id === example.presetId);
    if (preset) openStudioPreset(preset);
    return;
  }
  if (example.bundle) openStudioBundle(example.bundle);
}

export function useStudioInChat(): void {
  const session = useHarnessSessionStore.getState();
  const bundle = composeStudioBundle();
  session.replaceBundle(bundle as unknown as HarnessBundle);
  session.setEnabled(true);
  useShellStore.getState().setSection("chats");
}
