"use client";
import { Button } from "@/components/ui";
import { useSubagentStore } from "@/store/subagentStore";

/** Lets the next turn hand tasks to subagents (each can be cancelled on its own). */
export function SubagentToggle() {
  const enabled = useSubagentStore((s) => s.enabled);
  const setEnabled = useSubagentStore((s) => s.setEnabled);
  return (
    <Button
      size="sm"
      variant="ghost"
      role="switch"
      aria-checked={enabled}
      onClick={() => setEnabled(!enabled)}
      title="Let this turn hand tasks to subagents"
    >
      {`Subagents ${enabled ? "on" : "off"}`}
    </Button>
  );
}
