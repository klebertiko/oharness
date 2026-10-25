"use client";
import { Play, Redo2, Square, Undo2 } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { chordCaps, useIsMac } from "@/components/shell/keys";
import { Button, KbdChord, Segmented } from "@/components/ui";
import type { ExecutionMode } from "@/lib/types";

/**
 * The run bar: the one place for transport and history. Run is the editor's
 * single primary action. File actions live in the actions bar and bundle
 * checks in the dock, so nothing is offered twice; everything here is also in
 * the command palette.
 */

const MODES: { id: Extract<ExecutionMode, "mock" | "live">; label: string; hint: string }[] = [
  { id: "mock", label: "Mock", hint: "Deterministic replay: no provider is called" },
  { id: "live", label: "Connected", hint: "Run with each node’s pinned provider, local or cloud" },
];

interface Props {
  onRun: () => void;
  onStop: () => void;
}

export function Toolbar({ onRun, onStop }: Props) {
  const mac = useIsMac();
  const { nodes, executionMode, isRunning, setExecutionMode, undo, redo } = useCanvasStore();
  const runCaps = chordCaps("Mod+Enter", mac);
  const undoCaps = chordCaps("Mod+Z", mac).join(" ");
  const redoCaps = chordCaps("Mod+Shift+Z", mac).join(" ");

  return (
    <section aria-label="Run controls" className="flex-none border-b border-line bg-sub-100">
      <div role="toolbar" aria-label="Run and history" className="flex min-h-control-lg flex-wrap items-center gap-2 px-2 py-1">
        {isRunning ? (
          <Button onClick={onStop} icon={<Square size={10} strokeWidth={0} fill="currentColor" aria-hidden />}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={onRun} disabled={nodes.length === 0} title={nodes.length === 0 ? "Add a node to run" : undefined} icon={<Play size={11} strokeWidth={0} fill="currentColor" aria-hidden />}>
            Run
            <KbdChord caps={runCaps} className="max-sm:hidden [&_kbd]:border-transparent [&_kbd]:bg-[color-mix(in_oklab,var(--signal-ink)_16%,transparent)] [&_kbd]:text-signal-ink" />
          </Button>
        )}

        <Segmented
          label="Execution mode"
          value={executionMode === "mock" ? "mock" : "live"}
          onChange={setExecutionMode}
          options={MODES.map((m) => ({ value: m.id, label: m.label, hint: m.hint, disabled: isRunning }))}
        />

        <span className="mx-1 h-4 w-px bg-line max-sm:hidden" aria-hidden />

        <Button iconOnly variant="ghost" aria-label="Undo" title={`Undo · ${undoCaps}`} onClick={undo} disabled={isRunning} icon={<Undo2 size={14} strokeWidth={1.6} aria-hidden />} />
        <Button iconOnly variant="ghost" aria-label="Redo" title={`Redo · ${redoCaps}`} onClick={redo} disabled={isRunning} icon={<Redo2 size={14} strokeWidth={1.6} aria-hidden />} />
      </div>
    </section>
  );
}
