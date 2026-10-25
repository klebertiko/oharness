"use client";
/* The Studio editor's header: who this harness is (name, origin, saved or not)
   on the first row, and the file actions on the second, grouped by intent.
   Run belongs to the run bar above and bundle checks to the dock below, so no
   action appears twice. Destructive ones sit apart and always confirm. */
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, FilePlus, Layers, MessageSquare, Save, SaveAll, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore } from "@/store/copilotStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useShellStore } from "@/components/shell/shellStore";
import { Badge, Button, Notice } from "@/components/ui";
import { Combobox, type ComboOption } from "@/components/ui/Combobox";
import { cn } from "@/lib/utils";
import { newStudioHarness, openStudioExample, useStudioInChat } from "@/lib/studio";
import { discardStudioChanges, removeSavedHarness, saveHarnessAs, saveHarnessNow, useStudioDocsStore } from "@/lib/studioDocuments";
import { fetchStudioExamples, studioOrigin, type StudioExample } from "@/lib/studioExamples";

const ORIGIN_LABEL = { saved: "Saved harness", example: "Bundled harness", draft: "Draft" } as const;

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {children}
    </div>
  );
}

/** A label that gives way to the icon on narrow layouts; the name stays for assistive tech. */
const Label = ({ children }: { children: ReactNode }) => <span className="max-sm:sr-only">{children}</span>;

export function StudioActionsBar() {
  const { harnessMeta, nodes, isRunning } = useCanvasStore();
  const bundleId = useHarnessSessionStore((s) => s.activeBundle?.manifest?.id);
  const { saveState, dirty } = useStudioDocsStore();
  const setStudioView = useShellStore((s) => s.setStudioView);
  const openCopilot = useCopilotStore((s) => s.openCopilot);

  const origin = studioOrigin(harnessMeta.id, bundleId);
  const [pending, setPending] = useState<null | "saveas" | "discard" | "delete">(null);
  const [copyName, setCopyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [examples, setExamples] = useState<StudioExample[] | null>(null);
  const copyRef = useRef<HTMLInputElement>(null);

  const status =
    saveState === "saving" ? "Saving…"
      : saveState === "error" ? "Not saved — engine unreachable"
        : dirty ? "Unsaved changes"
          : harnessMeta.id ? "Saved" : "Not saved yet";
  const unsaved = status !== "Saved";

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await action();
      if (done) setNote({ tone: "ok", text: done });
      setPending(null);
    } catch (e) {
      setNote({ tone: "error", text: (e as Error).message || "That didn't work." });
    } finally {
      setBusy(false);
    }
  };

  const loadExamples = () => {
    if (!examples) void fetchStudioExamples().then(setExamples, () => setExamples([]));
  };
  const chooseExample = (id: string) => {
    const example = examples?.find((e) => e.id === id);
    if (!example) return;
    setNote(null);
    try {
      openStudioExample(example);
      setNote({ tone: "ok", text: `Opened a copy of ${example.name}. Save to keep it.` });
    } catch (e) {
      setNote({ tone: "error", text: (e as Error).message });
    }
  };
  const exampleOptions: ComboOption[] = (examples ?? []).map((ex) => ({ id: ex.id, label: ex.name, detail: ex.description || undefined }));

  const startSaveAs = () => {
    setCopyName(harnessMeta.id ? `${harnessMeta.name} copy` : harnessMeta.name);
    setPending("saveas");
    setNote(null);
  };
  const submitSaveAs = (e: FormEvent) => {
    e.preventDefault();
    void run(() => saveHarnessAs(copyName), `Saved as “${copyName.trim()}”`);
  };

  const locked = isRunning || busy;
  const deleteLabel = origin === "draft" ? "Delete draft" : "Delete";
  const canDelete = origin !== "example";
  const canDiscard = origin !== "saved" || dirty || saveState === "error";
  const confirmAction = () => {
    if (pending === "discard" || origin !== "saved") return run(discardStudioChanges);
    return run(() => removeSavedHarness(harnessMeta.id!));
  };

  return (
    <div className="flex-none border-b border-line bg-sub-100">
      <div className="flex items-center gap-x-3 gap-y-2 px-3 pt-2 max-sm:gap-x-1">
        <Button variant="ghost" onClick={() => setStudioView("overview")} icon={<ArrowLeft size={14} aria-hidden />}>
          <Label>Back to Studio</Label>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="t-title truncate text-ink" title={harnessMeta.name}>{harnessMeta.name}</h1>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Badge>{ORIGIN_LABEL[origin]}</Badge>
            <span role="status" className={cn("inline-flex items-center gap-1.5 text-body", saveState === "error" ? "text-fault-text" : "text-ink-mute")}>
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", unsaved ? "bg-ink-mute" : "bg-signal")} />
              {status}
            </span>
          </div>
        </div>
        <Button onClick={openCopilot} icon={<Sparkles size={14} aria-hidden />}>
          <Label>Ask Nilo</Label>
        </Button>
        <Button onClick={useStudioInChat} disabled={nodes.length === 0 || isRunning} icon={<MessageSquare size={14} aria-hidden />}>
          <Label>Use in chat</Label>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 px-3 py-2">
        <Group label="File">
          <Button variant="ghost" onClick={() => void run(async () => newStudioHarness())} disabled={locked} icon={<FilePlus size={14} aria-hidden />}>
            <Label>New</Label>
          </Button>
          <Combobox
            label="Bundled harnesses"
            triggerLabel="Open bundled harness"
            title="Open bundled harness"
            value={null}
            options={exampleOptions}
            onChange={chooseExample}
            onOpenChange={(open) => open && loadExamples()}
            status={examples ? "ready" : "loading"}
            loadingText="Loading bundled harnesses…"
            emptyText="No bundled harnesses available."
            header="Opens an editable copy; the bundled harness itself is never changed."
            width={320}
            disabled={locked}
            triggerClassName="h-control-md px-3 text-title font-medium text-ink-dim hover:text-ink max-sm:h-control-lg"
            trigger={
              <>
                <Layers size={14} aria-hidden />
                <Label>Open bundled harness</Label>
                <ChevronDown size={12} aria-hidden className="max-sm:hidden" />
              </>
            }
          />
        </Group>

        <span className="flex-1" />

        <Group label="Remove">
          <Button
            variant="ghost"
            onClick={() => { setPending("discard"); setNote(null); }}
            disabled={locked || !canDiscard}
            icon={<Undo2 size={14} aria-hidden />}
          >
            <Label>Discard</Label>
          </Button>
          {canDelete && (
            <Button variant="ghost" onClick={() => { setPending("delete"); setNote(null); }} disabled={locked} icon={<Trash2 size={14} aria-hidden />}>
              <Label>{deleteLabel}</Label>
            </Button>
          )}
        </Group>
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:inline-block" />
        <Group label="Save">
          <Button onClick={() => void run(saveHarnessNow, "Saved")} disabled={locked} icon={<Save size={14} aria-hidden />}>
            <Label>Save</Label>
          </Button>
          <Button onClick={startSaveAs} disabled={locked} icon={<SaveAll size={14} aria-hidden />}>
            <Label>Save as…</Label>
          </Button>
        </Group>
      </div>

      {pending === "saveas" && (
        <form onSubmit={submitSaveAs} className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2">
          <label htmlFor="studio-copy-name" className="text-body text-ink-mute">Save a copy as</label>
          <input
            ref={copyRef}
            id="studio-copy-name"
            aria-label="Name of the copy"
            value={copyName}
            autoFocus
            onChange={(e) => setCopyName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setPending(null); }}
            className="h-control-md min-w-48 max-w-[320px] flex-1 rounded-control border border-line-strong bg-sub-200 px-2 text-title text-ink focus-visible:border-signal max-sm:h-control-lg"
          />
          <Button type="submit" variant="primary" disabled={busy || !copyName.trim()}>Save copy</Button>
          <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
          <p className="basis-full text-meta text-ink-mute">
            Creates a new editable harness. {origin === "saved" ? "The original stays as it is." : "Bundled harnesses are never overwritten."}
          </p>
        </form>
      )}
      {(pending === "discard" || pending === "delete") && (
        <div
          role="group"
          aria-label={pending === "discard" ? "Confirm discard" : "Confirm delete"}
          onKeyDown={(e) => { if (e.key === "Escape") setPending(null); }}
          className="flex flex-wrap items-center gap-3 border-t border-line-soft px-3 py-2"
        >
          <p className="min-w-0 flex-1 text-title text-ink wrap-anywhere">
            {pending === "discard"
              ? origin === "saved"
                ? `Discard the changes to “${harnessMeta.name}” and go back to the saved version?`
                : `Discard “${harnessMeta.name}”? It has not been saved, so it is gone for good.`
              : origin === "saved"
                ? `Delete “${harnessMeta.name}” from this device? This can’t be undone.`
                : `Delete the draft “${harnessMeta.name}”? It has not been saved, so it is gone for good.`}
          </p>
          {/* Cancel is the default focus; the destructive button names the action. */}
          <Button autoFocus onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={() => void confirmAction()}>
            {pending === "discard" ? "Discard changes" : "Delete harness"}
          </Button>
        </div>
      )}
      {note && (
        <Notice tone={note.tone === "error" ? "fault" : "info"} className="m-2 mt-0">
          {note.text}
        </Notice>
      )}
    </div>
  );
}
