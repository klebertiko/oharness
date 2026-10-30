"use client";
import { create } from "zustand";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";
import { api } from "./api";
import { composeBundleFromCanvas } from "./bundlesApi";
import type { HarnessGraph, HarnessMeta, HarnessNode } from "./types";

/**
 * Studio harnesses as documents, the way Figma files or n8n workflows behave:
 * every harness the person actually edits is saved to the local engine's
 * database on disk (`harness.db`), listed on the Studio overview, and can be
 * opened again or deleted. An untouched "Untitled harness" is not a document
 * and is never written. Opening a sample or saved harness does not write
 * anything until the person edits it (`markClean`).
 */

const DEFAULT_NAMES = new Set(["untitled harness"]);
const RUNTIME_NODE_KEYS = ["status", "output", "tokens", "latencyMs", "error"] as const;
const RUNTIME_EDGE_KEYS = ["live"] as const;
// React Flow view state: selecting or measuring a node is not an edit.
export const VIEW_NODE_KEYS = ["selected", "dragging", "measured", "width", "height", "resizing"] as const;
export const VIEW_EDGE_KEYS = ["selected"] as const;
const RETRY_MS = 5000;
const AUTOSAVE_MS = 500;

type CanvasSnapshot = Pick<ReturnType<typeof useCanvasStore.getState>, "nodes" | "edges" | "harnessMeta">;
export type SaveState = "idle" | "saving" | "saved" | "error";

export function hasStudioDraft(s: CanvasSnapshot): boolean {
  return s.nodes.length > 0 || s.edges.length > 0
    || !DEFAULT_NAMES.has(s.harnessMeta.name.trim().toLowerCase())
    || s.harnessMeta.description.trim() !== "";
}

/** Authored content only — run output and view state never reach disk. */
export function stripRuntime(graph: HarnessGraph): HarnessGraph {
  return {
    nodes: graph.nodes.map((n) => {
      const node = { ...n } as Record<string, unknown>;
      for (const k of VIEW_NODE_KEYS) delete node[k];
      const data = { ...n.data } as Record<string, unknown>;
      for (const k of RUNTIME_NODE_KEYS) delete data[k];
      return { ...node, data } as unknown as HarnessNode;
    }),
    edges: graph.edges.map((e) => {
      const edge = { ...e } as Record<string, unknown>;
      for (const k of VIEW_EDGE_KEYS) delete edge[k];
      if (e.data) {
        const data = { ...e.data };
        for (const k of RUNTIME_EDGE_KEYS) delete data[k];
        edge.data = data;
      }
      return edge as unknown as typeof e;
    }),
  };
}

const contentKey = (s: CanvasSnapshot) => JSON.stringify({
  name: s.harnessMeta.name, description: s.harnessMeta.description, graph: stripRuntime(s),
});

interface DocsState {
  items: HarnessMeta[];
  loaded: boolean;
  error: string;
  saveState: SaveState;
  /** The open harness has edits not yet on disk. */
  dirty: boolean;
  refresh: () => Promise<void>;
}

export const useStudioDocsStore = create<DocsState>((set) => ({
  items: [],
  loaded: false,
  error: "",
  saveState: "idle",
  dirty: false,
  refresh: async () => {
    try {
      const items = await api.harnesses.list();
      set({ items, loaded: true, error: "" });
    } catch {
      set({ loaded: true, error: "Couldn't reach the local engine, so saved harnesses can't be listed right now." });
    }
  },
}));

/*
 * Saving model. Each harness open in the canvas is one "document session"
 * (`doc`). Saves are snapshots — content captured synchronously when the save
 * is requested — run one at a time through `queue`, so a save never reads a
 * canvas that has since been replaced. A create records the id for its
 * session (`docIds`), later snapshots of that session reuse it, and the id is
 * stamped onto the canvas only while that session is still the open one.
 */
interface Snap { doc: number; key: string; graph: HarnessGraph; meta: { id: string | null; name: string; description: string } }

let doc = 0;
const docIds = new Map<number, string>();
const savedKey = new Map<number, string>();
const failed = new Map<number, Snap>();
// Newest snapshot requested per session. The queue is FIFO, so the newest
// is always written last; a retry re-sends a failed snapshot only while it is
// still the newest, so it can never land after newer content.
const latest = new Map<number, Snap>();
const inQueue = new Map<number, number>();
const deleting = new Set<number>();
let queue: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };

function snapshot(): Snap {
  const s = useCanvasStore.getState();
  return { doc, key: contentKey(s), graph: stripRuntime(s), meta: { ...s.harnessMeta } };
}

function needsSave(): boolean {
  const s = useCanvasStore.getState();
  if (deleting.has(doc) || contentKey(s) === savedKey.get(doc)) return false;
  return Boolean(s.harnessMeta.id) || hasStudioDraft(s);
}

/**
 * The open harness is back to what is on disk (an edit was undone): drop its
 * failed save, so a retry can't write the abandoned edit, and clear "unsaved".
 */
function settleIfClean(): void {
  if (contentKey(useCanvasStore.getState()) !== savedKey.get(doc)) return;
  clearTimer();
  failed.delete(doc);
  latest.delete(doc);
  if (useStudioDocsStore.getState().dirty) useStudioDocsStore.setState({ dirty: false });
}

/** The canvas as it is now is a fresh, clean document session. */
export function markClean(): void {
  clearTimer();
  const previous = doc;
  doc += 1;
  prune(previous);
  savedKey.set(doc, contentKey(useCanvasStore.getState()));
  useStudioDocsStore.setState({ dirty: false, saveState: "idle" });
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    // Re-send a failed snapshot only if nothing newer was requested since.
    for (const [d, snap] of failed) if (d !== doc && latest.get(d) === snap) void enqueue(snap);
    if (needsSave()) void enqueue(snapshot());
  }, RETRY_MS);
}

/** Forget a finished, older session once nothing is queued or failing for it. */
function prune(d: number): void {
  if (d === doc || inQueue.get(d) || failed.has(d)) return;
  for (const m of [savedKey, docIds, latest, inQueue]) m.delete(d);
  deleting.delete(d);
}

async function persist(snap: Snap): Promise<void> {
  if (deleting.has(snap.doc) || snap.key === savedKey.get(snap.doc)) return;
  const current = () => snap.doc === doc;
  const id = snap.meta.id ?? docIds.get(snap.doc) ?? null;
  if (current()) useStudioDocsStore.setState({ saveState: "saving" });
  try {
    if (id) {
      await api.harnesses.update(id, { name: snap.meta.name, description: snap.meta.description, graph_json: snap.graph });
    } else {
      const res = await api.harnesses.create(snap.meta.name, snap.meta.description, snap.graph);
      docIds.set(snap.doc, res.id);
      if (current()) useCanvasStore.getState().setHarnessMeta({ id: res.id });
    }
    savedKey.set(snap.doc, snap.key);
    failed.delete(snap.doc);
    if (current()) useStudioDocsStore.setState({ saveState: "saved", dirty: needsSave() });
    void useStudioDocsStore.getState().refresh();
  } catch {
    failed.set(snap.doc, snap);
    if (current()) useStudioDocsStore.setState({ saveState: "error" });
    scheduleRetry();
  }
}

function enqueue(snap: Snap): Promise<void> {
  latest.set(snap.doc, snap);
  inQueue.set(snap.doc, (inQueue.get(snap.doc) ?? 0) + 1);
  queue = queue.then(() => persist(snap)).finally(() => {
    inQueue.set(snap.doc, (inQueue.get(snap.doc) ?? 1) - 1);
    prune(snap.doc);
  });
  return queue;
}

/** Save pending edits now; resolves once every queued save has finished. */
export function flushAutosave(): Promise<void> {
  clearTimer();
  return needsSave() ? enqueue(snapshot()) : queue;
}

/**
 * The only way to put a different harness on the canvas: pending edits of the
 * open one are captured and queued first, then `load` runs and starts a new
 * session. `saveNow` treats the loaded content as an edit (an import).
 */
export function replaceStudioCanvas(load: () => void, opts: { saveNow?: boolean } = {}): void {
  // The canvas can't be swapped mid-run (loadGraph refuses); don't start a
  // new session for content that never changed.
  if (useCanvasStore.getState().isRunning) return;
  settleIfClean();
  clearTimer();
  if (needsSave()) void enqueue(snapshot());
  load();
  markClean();
  if (opts.saveNow) {
    savedKey.delete(doc);
    if (needsSave()) {
      useStudioDocsStore.setState({ dirty: true });
      void enqueue(snapshot());
    }
  }
}

/** Debounced autosave of canvas edits. Returns the unsubscribe. */
export function startAutosave(): () => void {
  const schedule = () => {
    // Run status/output churn is not an edit; re-check once the run ends.
    if (useCanvasStore.getState().isRunning) return;
    if (!needsSave()) { settleIfClean(); return; }
    if (!useStudioDocsStore.getState().dirty) useStudioDocsStore.setState({ dirty: true });
    clearTimer();
    timer = setTimeout(() => void flushAutosave(), AUTOSAVE_MS);
  };
  const unsubscribe = useCanvasStore.subscribe(schedule);
  const onHide = () => { if (document.visibilityState === "hidden") void flushAutosave(); };
  document.addEventListener("visibilitychange", onHide);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onHide);
    clearTimer();
  };
}

function guardRun(): void {
  if (useCanvasStore.getState().isRunning) throw new Error("Stop the current run first.");
}

function loadIntoCanvas(graph: HarnessGraph, meta: { id: string | null; name: string; description: string }): void {
  replaceStudioCanvas(() => {
    const canvas = useCanvasStore.getState();
    canvas.loadGraph(graph.nodes, graph.edges);
    canvas.setHarnessMeta(meta);
    // Chat's "Use in chat" composes from this bundle; keep it about this harness.
    const bundle = composeBundleFromCanvas(null, { nodes: graph.nodes, edges: graph.edges, harnessMeta: meta });
    // A saved harness keeps its record id, so the chat picker sees one harness, not a saved row plus a "From Studio" copy.
    if (meta.id) bundle.manifest.id = meta.id;
    useHarnessSessionStore.getState().replaceBundle(bundle as unknown as HarnessBundle);
  });
}

export async function openSavedHarness(id: string): Promise<void> {
  guardRun();
  await flushAutosave();
  const record = await api.harnesses.get(id);
  guardRun();
  const raw = record.graph_json ?? { nodes: [], edges: [] };
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error("This saved harness has no editable graph.");
  loadIntoCanvas(stripRuntime(raw), { id: record.id, name: record.name, description: record.description ?? "" });
  useShellStore.getState().setSection("studio");
  useShellStore.getState().setStudioView("editor");
}

export async function removeSavedHarness(id: string): Promise<void> {
  const isOpen = useCanvasStore.getState().harnessMeta.id === id || docIds.get(doc) === id;
  const openDoc = isOpen ? doc : null;
  if (openDoc !== null) {
    guardRun();
    // Nothing may recreate what is being deleted: drop the pending save,
    // let saves already in flight land first, then delete.
    clearTimer();
    deleting.add(openDoc);
    await queue;
  }
  let res: Response;
  try {
    res = await api.harnesses.delete(id);
  } catch {
    res = new Response(null, { status: 503 });
  }
  if (!res.ok && res.status !== 404) {
    if (openDoc !== null) {
      deleting.delete(openDoc);
      void flushAutosave();
    }
    throw new Error("The local engine couldn't delete this harness. Try again.");
  }
  // No session may keep retrying (or later writing) a record that is gone.
  for (const [d, rid] of docIds) if (rid === id) { deleting.add(d); failed.delete(d); }
  for (const [d, snap] of failed) if (snap.meta.id === id) { deleting.add(d); failed.delete(d); }
  useStudioDocsStore.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  if (openDoc !== null && openDoc === doc) {
    loadIntoCanvas({ nodes: [], edges: [] }, { id: null, name: "Untitled harness", description: "" });
    useShellStore.getState().setStudioView("overview");
  }
}

/**
 * Explicit Save. A harness that has no record yet (an opened bundled example,
 * or a draft) is written as a new editable copy; the bundled original is never
 * touched. An already saved harness is just flushed.
 */
export async function saveHarnessNow(): Promise<void> {
  guardRun();
  clearTimer();
  await queue;
  const s = useCanvasStore.getState();
  if (!s.harnessMeta.id && !docIds.get(doc)) {
    if (!hasStudioDraft(s)) return;
    // markClean() recorded the loaded content as "on disk"; it is not.
    savedKey.delete(doc);
    useStudioDocsStore.setState({ dirty: true });
    await enqueue(snapshot());
    return;
  }
  await flushAutosave();
}

/**
 * Save as: always writes a new record and makes it the open harness. A harness
 * that was never saved is superseded by the copy (no second record from
 * autosave); a saved one keeps its record and its own pending edits.
 */
export async function saveHarnessAs(name: string): Promise<void> {
  const title = name.trim();
  if (!title) throw new Error("Give the copy a name.");
  guardRun();
  clearTimer();
  await queue;
  const open = useCanvasStore.getState();
  const saved = Boolean(open.harnessMeta.id || docIds.get(doc));
  const session = doc;
  if (saved) await flushAutosave();
  else deleting.add(session);
  const graph = stripRuntime(useCanvasStore.getState());
  const description = useCanvasStore.getState().harnessMeta.description;
  let res: { id: string };
  try {
    res = await api.harnesses.create(title, description, graph);
  } catch {
    if (!saved) deleting.delete(session);
    throw new Error("The local engine couldn't save the copy. Try again.");
  }
  loadIntoCanvas(graph, { id: res.id, name: title, description });
  void useStudioDocsStore.getState().refresh();
}

/**
 * Discard: throw away what is not on disk. A harness that was never saved
 * goes back to an empty Untitled harness and the overview; a saved one is
 * reloaded from its record. Nothing pending may be saved afterwards.
 */
export async function discardStudioChanges(): Promise<void> {
  guardRun();
  clearTimer();
  const session = doc;
  deleting.add(session);
  failed.delete(session);
  latest.delete(session);
  await queue;
  const id = useCanvasStore.getState().harnessMeta.id ?? docIds.get(session) ?? null;
  if (!id) {
    loadIntoCanvas({ nodes: [], edges: [] }, { id: null, name: "Untitled harness", description: "" });
    useShellStore.getState().setStudioView("overview");
    return;
  }
  try {
    const record = await api.harnesses.get(id);
    const raw = record.graph_json ?? { nodes: [], edges: [] };
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error("no graph");
    loadIntoCanvas(stripRuntime(raw), { id: record.id, name: record.name, description: record.description ?? "" });
  } catch {
    deleting.delete(session);
    throw new Error("Couldn't reload the saved version. Your changes are kept.");
  }
}
