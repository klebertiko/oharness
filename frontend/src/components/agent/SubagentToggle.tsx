"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/store";
import { useSubagentStore } from "@/store/subagentStore";

/**
 * Lets the next turn hand tasks to subagents (each can be cancelled on its own). Remembered across restarts.
 * `unavailable` says why a turn cannot use them right now; the switch is then disabled and shows that reason, never a stale "on".
 */
export function SubagentToggle({ unavailable }: { unavailable?: "harness" | "plan" }) {
  const t = useT();
  const stored = useSubagentStore((s) => s.enabled);
  const setEnabled = useSubagentStore((s) => s.setEnabled);
  // The static page always renders "off"; show the remembered choice once the client has taken over.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const enabled = mounted && stored && !unavailable;
  return (
    <Button
      size="sm"
      variant="ghost"
      role="switch"
      aria-checked={enabled}
      disabled={Boolean(unavailable)}
      onClick={() => setEnabled(!stored)}
      title={unavailable ? t(unavailable === "plan" ? "subagents.toggle.plan" : "subagents.toggle.harness") : t("subagents.toggle.title")}
    >
      {unavailable ? t(unavailable === "plan" ? "subagents.toggle.plan" : "subagents.toggle.harness") : t(enabled ? "subagents.toggle.on" : "subagents.toggle.off")}
    </Button>
  );
}
