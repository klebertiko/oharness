"use client";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui";
import { useShellStore } from "./shellStore";

/**
 * Status bar: what is true right now about the editor, in words. Counts and
 * ids are measured values set in mono; everything else is plain text. Cells
 * that only repeat the header are not shown. Below 640px only the run state
 * and the engine stay, so nothing clips.
 */

function Cell({ children, tone = "dim", className }: { children: React.ReactNode; tone?: "dim" | "fault"; className?: string }) {
  return (
    <span className={cn("t-meta flex items-center gap-1.5 border-r border-line-soft px-2.5 whitespace-nowrap", tone === "fault" ? "text-fault-text" : "text-ink-mute", className)}>
      {children}
    </span>
  );
}

interface Props {
  /** Execution mode of the next run: mock, live or local. */
  mode: string;
  running: boolean;
  nodeCount: number;
  edgeCount: number;
  selectedId: string | null;
  backendOk: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function StatusBar({ mode, running, nodeCount, edgeCount, selectedId, backendOk }: Props) {
  const setKeymapOpen = useShellStore((s) => s.setKeymapOpen);

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: this footer is the page-level contentinfo landmark, which accepts a label
    <footer aria-label="Status" className="flex h-statusbar flex-none items-stretch bg-sub-100 shadow-[inset_0_1px_0_var(--line)]">
      <Cell>
        <span className={cn("h-1.5 w-1.5 rounded-none", running ? "bg-signal" : "bg-ink-mute")} aria-hidden />
        <span className="text-ink-dim" role="status">{running ? "Running" : "Ready"}</span>
      </Cell>
      <Cell className="max-sm:hidden">{mode} runs</Cell>
      <Cell className="max-sm:hidden">
        {plural(nodeCount, "node", "nodes")} · {plural(edgeCount, "connection", "connections")}
      </Cell>
      {selectedId && <Cell className="min-w-0 max-sm:hidden"><span className="truncate">Selected {selectedId}</span></Cell>}

      <span className="flex-1" />

      <Cell tone={backendOk ? "dim" : "fault"} className="border-l border-r-0">
        <span role="status">{backendOk ? "Engine connected" : "Engine offline"}</span>
      </Cell>
      <button
        type="button"
        onClick={() => setKeymapOpen(true)}
        className="oh-focus-inner t-meta flex items-center gap-1.5 px-2.5 text-ink-mute transition-colors hover:bg-sub-300 hover:text-ink-dim max-sm:hidden"
      >
        <Kbd>?</Kbd>
        Shortcuts
      </button>
    </footer>
  );
}
