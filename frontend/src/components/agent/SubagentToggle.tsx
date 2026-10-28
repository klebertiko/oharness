"use client";
import { useId } from "react";
import { useSubagentStore } from "@/store/subagentStore";

/** Lets the next turn hand tasks to subagents (each can be cancelled on its own). */
export function SubagentToggle() {
  const id = useId();
  const enabled = useSubagentStore((s) => s.enabled);
  const setEnabled = useSubagentStore((s) => s.setEnabled);
  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-meta text-ink-mute">
      <input id={id} type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      Subagents
    </label>
  );
}
