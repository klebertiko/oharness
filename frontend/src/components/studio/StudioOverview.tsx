"use client";
/* Hallmark · genre: modern-minimal editorial workspace · macrostructure: Graph Workshop overview
   (describe-first hero → document list + starting-points rail) · design-system: design.md · designed-as-app */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowRight, FileText, FolderOpen, Plus, Trash2, Workflow } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { newStudioHarness, openBundledHarness, openStudioExample, openStudioPreset } from "@/lib/studio";
import { fetchStudioExamples, type StudioExample } from "@/lib/studioExamples";
import { HARNESS_PRESETS } from "@/lib/templates";
import { discardStudioChanges, flushAutosave, hasStudioDraft, openSavedHarness, removeSavedHarness, useStudioDocsStore } from "@/lib/studioDocuments";
import { formatRelativeTime } from "@/lib/time";
import { chordCaps, useIsMac } from "@/components/shell/keys";
import { KbdChord } from "@/components/ui";
import { COPILOT_ENABLED } from "@/lib/features";
import { startCopilotFromOverview } from "@/lib/copilotEntry";
import { Badge, Button, EmptyState, Notice, SkeletonRows } from "@/components/ui";
import { ScrollRail } from "./ScrollRail";

// One card for every rail in the overview: fixed width so a row of them reads as a rhythm,
// equal height from the rail's stretch, long text wrapped or clamped instead of overflowing.
const railCard = "flex w-68 flex-none flex-col items-start gap-3 rounded-float border border-line bg-sub-100 p-4 [&_h3]:line-clamp-2 [&_h3]:wrap-anywhere [&_p]:wrap-anywhere [&_h3+p]:line-clamp-3";
const PROMPT_LIMIT = 2000;
const DRAFT_ROW = "__draft__";

// The engine stores naive UTC timestamps; read them as UTC, not local time.
function edited(iso: string | null | undefined): string {
  const utc = iso && !/(z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso + "Z" : iso;
  const rel = formatRelativeTime(utc);
  return rel === "just now" || rel === "—" ? `Edited ${rel}` : `Edited ${rel} ago`;
}

/** A row in "Your harnesses": a document name with one line of state beneath it. */
function DocumentLine({ name, status, live }: { name: string; status: string; live?: boolean }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3">
      <FileText size={16} strokeWidth={1.6} aria-hidden className="mt-0.5 flex-none text-ink-mute" />
      <div className="min-w-0 flex-1">
        <h3 title={name} className="t-title text-ink wrap-anywhere">{name}</h3>
        <div className="mt-1 flex items-start gap-1.5 text-body leading-5 text-ink-mute">
          {live && <span aria-hidden className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-signal" />}
          <p title={status} className="min-w-0 line-clamp-3 wrap-anywhere">{status}</p>
        </div>
      </div>
    </div>
  );
}

export function StudioOverview() {
  const mac = useIsMac();
  const { harnessMeta, nodes, edges, isRunning } = useCanvasStore();
  const { setStudioView, setLibraryOpen } = useShellStore();
  const { items, loaded, error: listError, saveState, dirty, refresh } = useStudioDocsStore();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");
  const unsavedDraft = !harnessMeta.id && hasStudioDraft({ nodes, edges, harnessMeta });
  useEffect(() => { void refresh(); }, [refresh]);
  // Every example the engine's catalog returns, beyond the two fixed cards below.
  const [extraExamples, setExtraExamples] = useState<StudioExample[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchStudioExamples().then(
      (all) => { if (alive) setExtraExamples(all.filter((e) => !e.presetId && !/^oharness\.default\b/.test(e.id))); },
      () => {},
    );
    return () => { alive = false; };
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [copilotError, setCopilotError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const openSaved = async (id: string) => {
    setRowError("");
    try { await openSavedHarness(id); } catch (e) { setRowError((e as Error).message || "Could not open this harness."); }
  };
  const remove = async (id: string) => {
    setRowError("");
    try { await removeSavedHarness(id); setConfirmId(null); } catch (e) { setRowError((e as Error).message); }
  };
  // Return focus to the row's delete button so keyboard users don't lose their place.
  const discardDraft = async () => {
    setRowError("");
    try { await discardStudioChanges(); setConfirmId(null); } catch (e) { setRowError((e as Error).message); }
  };
  const cancelDelete = (id: string) => {
    setConfirmId(null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-delete-for="${CSS.escape(id)}"]`)?.focus());
  };
  const startFresh = async (start: () => void | Promise<void>) => {
    await flushAutosave();
    await start();
  };

  const openFramework = async () => {
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      await openBundledHarness(controller.signal);
    } catch {
      if (!controller.signal.aborted) setError("Could not load the bundled harness. Check that the local engine is available, then try again.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const description = prompt.trim();
  const canDraft = description.length > 0 && !drafting && !isRunning && !loading;
  const draftWithCopilot = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canDraft) return;
    setCopilotError("");
    setDrafting(true);
    try {
      await startCopilotFromOverview(description);
    } catch (err) {
      setCopilotError((err as Error).message || "Nilo could not start.");
    } finally {
      setDrafting(false);
    }
  };
  const onPromptKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation(); // Mod+Enter is also an app chord; here it only means "draft".
    void draftWithCopilot();
  };

  const startDisabled = loading || isRunning;
  const newHarness = (
    <Button size="lg" variant={COPILOT_ENABLED ? "secondary" : "primary"} onClick={() => void startFresh(newStudioHarness)} disabled={startDisabled} icon={<Plus size={14} aria-hidden />}>
      New harness
    </Button>
  );
  const openOhm = (
    <Button size="lg" variant={COPILOT_ENABLED ? "ghost" : "secondary"} onClick={() => setLibraryOpen(true)} disabled={startDisabled} icon={<FolderOpen size={14} aria-hidden />}>
      Open .ohm
    </Button>
  );
  const hasRows = items.length > 0 || unsavedDraft;

  return (
    <section aria-labelledby="studio-heading" className="h-full min-w-0 overflow-y-auto px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-[1040px]">
        {COPILOT_ENABLED ? (
          <header className="max-w-[760px]">
            <h1 id="studio-heading" className="t-display text-display text-ink wrap-anywhere">Harness Studio</h1>
            <p className="mt-2 text-title leading-6 text-ink-mute">Say what the harness should do. Nilo drafts the graph; you review every change.</p>
            <form onSubmit={(e) => void draftWithCopilot(e)} className="oh-agent-composer mt-5">
              <label htmlFor="studio-describe" className="sr-only">Describe the harness you want</label>
              <textarea
                id="studio-describe"
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); if (copilotError) setCopilotError(""); }}
                onKeyDown={onPromptKey}
                maxLength={PROMPT_LIMIT}
                rows={3}
                placeholder="Describe the harness you want… e.g. research a topic, draft a brief, then a review gate before a person approves."
                aria-describedby={copilotError ? "studio-describe-error" : undefined}
                className="block min-h-22 w-full resize-y rounded-t-composer bg-transparent px-4 pb-2 pt-4 text-reading text-ink placeholder:text-ink-mute focus-visible:outline-hidden"
              />
              <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5 pt-1">
                <div className="flex flex-wrap gap-2">{newHarness}{openOhm}</div>
                <div className="ml-auto flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-meta text-ink-mute max-sm:hidden"><KbdChord caps={chordCaps("Mod+Enter", mac)} /> to draft</span>
                  <Button type="submit" size="lg" variant="primary" disabled={!canDraft} loading={drafting} title={!canDraft && !drafting ? "Describe the harness to draft it" : undefined} icon={<ArrowRight size={14} aria-hidden />}>
                    {drafting ? "Drafting…" : "Draft with Nilo"}
                  </Button>
                </div>
              </div>
            </form>
            {copilotError && <Notice tone="fault" className="mt-3"><span id="studio-describe-error">{copilotError}</span></Notice>}
          </header>
        ) : (
          <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div className="min-w-0 max-w-[560px]">
              <h1 id="studio-heading" className="t-display text-display text-ink wrap-anywhere">Harness Studio</h1>
              <p className="mt-2 text-title leading-6 text-ink-mute">Design a workflow. Connect its agents. Share it as OHM.</p>
            </div>
            <div className="flex flex-wrap gap-2">{newHarness}{openOhm}</div>
          </header>
        )}

        {isRunning && <Notice className="mt-5">A run is in progress. Continue editing to inspect or stop it before opening another harness.</Notice>}

        <div className="mt-8 grid grid-cols-1 gap-10 border-t border-line pt-8">
          <section aria-labelledby="your-harnesses" className="relative min-w-0 [&>p]:pr-20">
            <div className="flex items-baseline gap-2">
              <h2 id="your-harnesses" className="t-title text-ink">Your harnesses</h2>
              {items.length > 0 && <span className="t-meta text-ink-mute">{items.length}</span>}
            </div>
            <p className="mt-1 text-body leading-5 text-ink-mute">Saved on this device as you edit. Export an OHM file to share a copy.</p>
            {listError && (
              <Notice tone="fault" className="mt-4" title="Couldn't load your harnesses" action={<Button size="sm" onClick={() => void refresh()}>Retry</Button>}>
                {listError}
              </Notice>
            )}
            {rowError && <Notice tone="fault" className="mt-3">{rowError}</Notice>}
            {!loaded && !listError && <SkeletonRows rows={1} label="Loading your harnesses" className="mt-4 *:h-38 *:w-68" />}
            {loaded && !listError && !hasRows && (
              <EmptyState className="mt-4" title="Nothing saved yet">A new harness is saved here as soon as you edit it.</EmptyState>
            )}
            {hasRows && (
              <ScrollRail as="ul" labelledBy="your-harnesses" className="mt-4">
                {unsavedDraft && (
                  <li className={`${railCard} border-line-strong`}>
                    {confirmId === DRAFT_ROW ? (
                      <div role="group" aria-label={`Delete ${harnessMeta.name}`} className="flex w-full flex-col gap-3"
                        onKeyDown={(e) => { if (e.key === "Escape") cancelDelete(DRAFT_ROW); }}>
                        <p className="min-w-0 flex-1 text-title leading-6 text-ink wrap-anywhere">Delete the draft “{harnessMeta.name}”? It hasn’t been saved, so it’s gone for good.</p>
                        <div className="flex gap-2">
                          <Button autoFocus onClick={() => cancelDelete(DRAFT_ROW)}>Cancel</Button>
                          <Button variant="danger" onClick={() => void discardDraft()}>Delete</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <DocumentLine
                          name={harnessMeta.name}
                          live
                          status={!dirty ? "Open now · it's saved here once you change it." : saveState === "error" ? "Not saved yet — the local engine is unreachable. It saves as soon as it can." : "Saving…"}
                        />
                        <div className="mt-auto flex w-full items-center justify-between gap-2">
                          <Button aria-label={`Continue editing ${harnessMeta.name}`} onClick={() => setStudioView("editor")} icon={<ArrowRight size={14} aria-hidden />} className="flex-row-reverse">
                            Continue editing
                          </Button>
                          <Button iconOnly variant="ghost" data-delete-for={DRAFT_ROW} aria-label={`Delete ${harnessMeta.name}`} title="Delete draft" disabled={isRunning}
                            onClick={() => setConfirmId(DRAFT_ROW)} icon={<Trash2 size={14} aria-hidden />} />
                        </div>
                      </>
                    )}
                  </li>
                )}
                {items.map((item) => {
                  const open = item.id === harnessMeta.id;
                  return (
                    <li key={item.id} className={`${railCard} transition-colors ${open ? "border-line-strong" : "hover:bg-sub-200"}`}>
                      {confirmId === item.id ? (
                        <div role="group" aria-label={`Delete ${item.name}`} className="flex w-full flex-col gap-3"
                          onKeyDown={(e) => { if (e.key === "Escape") cancelDelete(item.id); }}>
                          <p className="min-w-0 flex-1 text-title leading-6 text-ink wrap-anywhere">Delete “{item.name}” from this device? This can’t be undone.</p>
                          <div className="flex gap-2">
                            <Button autoFocus onClick={() => cancelDelete(item.id)}>Cancel</Button>
                            <Button variant="danger" onClick={() => void remove(item.id)}>Delete</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <DocumentLine
                            name={item.name}
                            live={open}
                            status={open ? (saveState === "saving" ? "Open · saving…" : saveState === "error" ? "Open · last changes not saved" : "Open now") : edited(item.updated_at)}
                          />
                          <div className="mt-auto flex w-full items-center justify-between gap-2">
                            <Button aria-label={`${open ? "Continue editing" : "Open"} ${item.name}`} disabled={isRunning && !open} onClick={() => (open ? setStudioView("editor") : void openSaved(item.id))} icon={<ArrowRight size={14} aria-hidden />} className="flex-row-reverse">
                              {open ? "Continue editing" : "Open"}
                            </Button>
                            <Button iconOnly variant="ghost" data-delete-for={item.id} aria-label={`Delete ${item.name}`} title="Delete" disabled={isRunning && open}
                              onClick={() => setConfirmId(item.id)} icon={<Trash2 size={14} aria-hidden />} />
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ScrollRail>
            )}
          </section>

          <aside aria-labelledby="starting-points" className="relative min-w-0 [&>p]:pr-20">
            <h2 id="starting-points" className="t-title text-ink">Starting points</h2>
            <p className="mt-1 text-body leading-5 text-ink-mute">Open a bundled harness, such as the Agile Harness, as an editable copy. Your work stays saved.</p>
            <ScrollRail labelledBy="starting-points" className="mt-4">
              <article className={railCard}>

                <div className="flex items-center gap-2">
                  <Workflow size={14} strokeWidth={1.6} aria-hidden className="flex-none text-ink-mute" />
                  <Badge>Bundled harness</Badge>
                </div>
                <div className="min-w-0">
                  <h3 className="t-title text-ink">Agent + review</h3>
                  <p className="mt-1 text-body leading-5 text-ink-mute">Agent → review gate → human approval. Three nodes, configured for mock runs.</p>
                </div>
                <Button disabled={startDisabled} aria-label="Open harness: Agent + review" className="mt-auto flex-row-reverse" icon={<ArrowRight size={14} aria-hidden />} onClick={() => {
                  const sample = HARNESS_PRESETS.find((p) => p.id === "minimal-gate");
                  if (sample) void startFresh(() => openStudioPreset(sample));
                }}>Open harness</Button>
              </article>
              <article className={railCard}>
                <div className="flex items-center gap-2">
                  <Workflow size={14} strokeWidth={1.6} aria-hidden className="flex-none text-ink-mute" />
                  <Badge>Bundled harness</Badge>
                </div>
                <div className="min-w-0">
                  <h3 className="t-title text-ink">Agile Harness</h3>
                  <p className="mt-1 text-body leading-5 text-ink-mute">Includes agent profiles and harness guidance. The graph is adapted from the skills-framework workflow, not the complete workflow.</p>
                </div>
                <Button disabled={startDisabled} loading={loading} aria-label="Open harness: Agile Harness" className="mt-auto flex-row-reverse" icon={<ArrowRight size={14} aria-hidden />} onClick={() => void startFresh(openFramework)}>
                  {loading ? "Opening…" : "Open harness"}
                </Button>
              </article>
              {extraExamples.map((ex) => (
                <article key={ex.id} className={railCard}>
                  <div className="flex items-center gap-2">
                    <Workflow size={14} strokeWidth={1.6} aria-hidden className="flex-none text-ink-mute" />
                    <Badge>Bundled harness</Badge>
                  </div>
                  <div className="min-w-0">
                    <h3 title={ex.name} className="t-title text-ink">{ex.name}</h3>
                    {ex.description && <p title={ex.description} className="mt-1 line-clamp-3 text-body leading-5 text-ink-mute">{ex.description}</p>}
                  </div>
                  <Button disabled={startDisabled} aria-label={`Open harness: ${ex.name}`} className="mt-auto flex-row-reverse" icon={<ArrowRight size={14} aria-hidden />}
                    onClick={() => void startFresh(() => openStudioExample(ex))}>
                    Open harness
                  </Button>
                </article>
              ))}
            </ScrollRail>
            {error && <Notice tone="fault" className="mt-3">{error}</Notice>}
          </aside>
        </div>
      </div>
    </section>
  );
}
