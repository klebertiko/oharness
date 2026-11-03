"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CheckCircle2, Download, FlaskConical, Upload } from "lucide-react";
import { composeBundleFromCanvas, isOHarnessBundle, mockBundle, validateBundle, type MockStep } from "@/lib/bundlesApi";
import { saveOhmFile } from "@/lib/ohmFile";
import { openStudioBundle } from "@/lib/studio";
import { VIEW_EDGE_KEYS, VIEW_NODE_KEYS } from "@/lib/studioDocuments";
import { tr, trn, useT } from "@/i18n/store";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";
type DockStatus = "idle" | "working" | "ok" | "error";
// Selection, dragging, measuring and run telemetry do not change what was validated.
function without(record: object, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}
function draftKey() {
  const { nodes, edges, harnessMeta } = useCanvasStore.getState();
  const activeBundle = useHarnessSessionStore.getState().activeBundle;
  return JSON.stringify({
    nodes: nodes.map(node => ({ ...without(node, VIEW_NODE_KEYS), data: without(node.data, ["status", "output", "error", "tokens", "latencyMs"]) })),
    edges: edges.map(edge => without(edge, VIEW_EDGE_KEYS)),
    // The record id is assigned by the first autosave; it is not something the person authored.
    harnessMeta: { name: harnessMeta.name, description: harnessMeta.description }, activeBundle,
  });
}
export function ValidateDock() {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);
  const [status, setStatus] = useState<DockStatus>("idle");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [steps, setSteps] = useState<MockStep[]>([]);
  const [resultFor, setResultFor] = useState("");
  // "Imported" reports an event, not a claim about the draft: the canvas may still settle after
  // openStudioBundle, so it must not depend on the draft key. The next dock action replaces it.
  const [imported, setImported] = useState(false);
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const harnessMeta = useCanvasStore(s => s.harnessMeta);
  const running = useCanvasStore(s => s.isRunning);
  const activeBundle = useHarnessSessionStore(s => s.activeBundle);
  const key = draftKey();
  const fresh = imported || resultFor === key;
  const busy = resultFor === key && status === "working";
  const compose = () => composeBundleFromCanvas(isOHarnessBundle(activeBundle) ? activeBundle : null, { nodes, edges, harnessMeta });
  function begin(label: string) {
    const ticket = ++requestId.current, stamp = draftKey();
    setImported(false); setResultFor(stamp); setStatus("working"); setMessage(label); setErrors([]); setSteps([]);
    // An import replaces the whole draft, so only a newer dock action may supersede it; the canvas
    // settling while the file is validated (autosave, view sync) must not silently drop the import.
    return (draftBound = true) => ticket === requestId.current && (!draftBound || stamp === draftKey());
  }
  function fail(error: unknown) { setStatus("error"); setMessage(error instanceof Error ? error.message : tr("studio.dock.failed")); }
  async function inspect(kind: "validate" | "mock") {
    if (useCanvasStore.getState().isRunning) return;
    const current = begin(kind === "validate" ? tr("studio.dock.validating") : tr("studio.dock.planning"));
    try {
      const bundle = compose();
      if (kind === "validate") {
        const result = await validateBundle(bundle); if (!current()) return;
        setStatus(result.ok ? "ok" : "error"); setMessage(result.ok ? tr("studio.dock.valid") : tr("studio.dock.invalid")); setErrors(result.errors ?? []);
      } else {
        const result = await mockBundle(bundle); if (!current()) return;
        setStatus(result.ok ? "ok" : "error");
        setMessage(result.ok ? trn("studio.dock.simOk", result.steps.length) : tr("studio.dock.simRejected"));
        setErrors(result.errors ?? []); setSteps(result.steps ?? []);
      }
    } catch (error) { if (current()) fail(error); }
  }
  async function onExport() {
    const current = begin(tr("studio.dock.exporting"));
    try {
      const result = await saveOhmFile(compose());
      if (!current()) return;
      if (result.status === "cancelled") { setStatus("idle"); setMessage(""); return; }
      setStatus("ok"); setMessage(result.native ? tr("studio.dock.savedTo", { name: result.name }) : tr("studio.dock.downloaded"));
    } catch (error) { if (current()) fail(error); }
  }
  async function onImportFile(file: File) {
    if (useCanvasStore.getState().isRunning) return;
    const current = begin(tr("studio.dock.importing", { name: file.name }));
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = await validateBundle(parsed);
      if (!current(false) || useCanvasStore.getState().isRunning) return;
      if (!result.ok) { setStatus("error"); setMessage(tr("studio.dock.importInvalid")); setErrors(result.errors ?? []); return; }
      if (!isOHarnessBundle(parsed)) { setStatus("error"); setMessage(tr("studio.dock.notBundle")); return; }
      openStudioBundle(parsed as unknown as HarnessBundle);
      setImported(true); setStatus("ok"); setMessage(tr("studio.dock.imported", { id: parsed.manifest.id }));
    } catch (error) { if (current()) fail(error); }
  }
  return <section aria-label={t("studio.dock.title")} className="flex flex-none flex-col border-t border-line bg-sub-100">
    <div className="flex min-h-control-lg flex-wrap items-center gap-1 border-b border-line-soft px-2 py-1">
      <span className="t-label mr-1 text-ink-mute" aria-hidden>{t("studio.dock.title")}</span>
      <DockAction icon={CheckCircle2} label={t("studio.dock.validate")} onClick={() => void inspect("validate")} disabled={busy || running} />
      <DockAction icon={FlaskConical} label={t("studio.dock.simulate")} onClick={() => void inspect("mock")} disabled={busy || running} />
      <span className="mx-1 h-4 w-px bg-line-soft max-sm:hidden" aria-hidden />
      <DockAction icon={Download} label={t("studio.dock.export")} onClick={() => void onExport()} disabled={busy} />
      <DockAction icon={Upload} label={t("studio.dock.import")} onClick={() => fileRef.current?.click()} disabled={busy || running} />
      <input ref={fileRef} type="file" accept=".ohm,.oharness,application/json" className="hidden" disabled={running} aria-label={t("studio.dock.importAria")} tabIndex={-1}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void onImportFile(file); }} />
      <span className="flex-1" />
      {fresh && message && <span role="status" className={"text-body min-w-0 truncate " + (status === "error" ? "text-fault-text" : status === "ok" ? "text-signal-text" : "text-ink-mute")} title={message}>{message}</span>}
    </div>
    {fresh && (errors.length > 0 || steps.length > 0) && <div className="max-h-30 overflow-y-auto px-2.5 py-1.5">
      {errors.length > 0 && <ul className="space-y-0.5">{errors.map((error, i) => <li key={i} className="t-body text-fault-text">{error}</li>)}</ul>}
      {steps.length > 0 && <ol className="space-y-0.5">{steps.map((step, i) => <li key={step.nodeId + i} className="t-meta text-ink-dim">{i + 1}. {step.role} ({step.nodeId}) — {step.status}{step.note ? " · " + step.note : ""}</li>)}</ol>}
    </div>}
  </section>;
}
function DockAction({ icon: Icon, label, onClick, disabled }: { icon: typeof CheckCircle2; label: string; onClick: () => void; disabled?: boolean }) {
  return <Button variant="ghost" size="sm" disabled={disabled} onClick={onClick} aria-label={label} title={label} icon={<Icon size={12} strokeWidth={1.6} absoluteStrokeWidth aria-hidden />}>
    <span className="max-sm:sr-only">{label}</span>
  </Button>;
}
