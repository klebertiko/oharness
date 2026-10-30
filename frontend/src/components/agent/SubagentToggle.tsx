"use client";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/store";
import { useSubagentStore } from "@/store/subagentStore";

/** Lets the next turn hand tasks to subagents (each can be cancelled on its own). Remembered across restarts. */
export function SubagentToggle() {
  const t = useT();
  const enabled = useSubagentStore((s) => s.enabled);
  const setEnabled = useSubagentStore((s) => s.setEnabled);
  return (
    <Button size="sm" variant="ghost" role="switch" aria-checked={enabled} onClick={() => setEnabled(!enabled)} title={t("subagents.toggle.title")}>
      {t(enabled ? "subagents.toggle.on" : "subagents.toggle.off")}
    </Button>
  );
}
