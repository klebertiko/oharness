"use client";
import { Play, Redo2, Square, Undo2 } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { chordCaps, useIsMac } from "@/components/shell/keys";
import { Button, KbdChord, Segmented } from "@/components/ui";
import type { ExecutionMode } from "@/lib/types";
import { useT } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";

/**
 * The run bar: the one place for transport and history. Run is the editor's
 * single primary action. File actions live in the actions bar and bundle
 * checks in the dock, so nothing is offered twice; everything here is also in
 * the command palette.
 */

const MODES: { id: Extract<ExecutionMode, "mock" | "live">; label: MessageKey; hint: MessageKey }[] = [
  { id: "mock", label: "studio.toolbar.mockLabel", hint: "studio.toolbar.mockHint" },
  { id: "live", label: "studio.toolbar.liveLabel", hint: "studio.toolbar.liveHint" },
];

interface Props {
  onRun: () => void;
  onStop: () => void;
}

export function Toolbar({ onRun, onStop }: Props) {
  const t = useT();
  const mac = useIsMac();
  const { nodes, executionMode, isRunning, setExecutionMode, undo, redo } = useCanvasStore();
  const runCaps = chordCaps("Mod+Enter", mac);
  const undoCaps = chordCaps("Mod+Z", mac).join(" ");
  const redoCaps = chordCaps("Mod+Shift+Z", mac).join(" ");

  return (
    <section aria-label={t("studio.toolbar.controls")} className="flex-none border-b border-line bg-sub-100">
      <div role="toolbar" aria-label={t("studio.toolbar.runHistory")} className="flex min-h-control-lg flex-wrap items-center gap-2 px-2 py-1">
        {isRunning ? (
          <Button onClick={onStop} icon={<Square size={10} strokeWidth={0} fill="currentColor" aria-hidden />}>
            {t("studio.toolbar.stop")}
          </Button>
        ) : (
          <Button variant="primary" onClick={onRun} disabled={nodes.length === 0} title={nodes.length === 0 ? t("studio.toolbar.addNode") : undefined} icon={<Play size={11} strokeWidth={0} fill="currentColor" aria-hidden />}>
            {t("studio.toolbar.run")}
            <KbdChord caps={runCaps} className="max-sm:hidden [&_kbd]:border-[color-mix(in_oklab,var(--signal-ink)_45%,transparent)] [&_kbd]:bg-transparent [&_kbd]:text-signal-ink" />
          </Button>
        )}

        <Segmented
          label={t("studio.toolbar.mode")}
          value={executionMode === "mock" ? "mock" : "live"}
          onChange={setExecutionMode}
          options={MODES.map((m) => ({ value: m.id, label: t(m.label), hint: t(m.hint), disabled: isRunning }))}
        />

        <span className="mx-1 h-4 w-px bg-line max-sm:hidden" aria-hidden />

        <Button iconOnly variant="ghost" aria-label={t("studio.toolbar.undo")} title={t("studio.toolbar.undoTitle", { keys: undoCaps })} onClick={undo} disabled={isRunning} icon={<Undo2 size={14} strokeWidth={1.6} aria-hidden />} />
        <Button iconOnly variant="ghost" aria-label={t("studio.toolbar.redo")} title={t("studio.toolbar.redoTitle", { keys: redoCaps })} onClick={redo} disabled={isRunning} icon={<Redo2 size={14} strokeWidth={1.6} aria-hidden />} />
      </div>
    </section>
  );
}
