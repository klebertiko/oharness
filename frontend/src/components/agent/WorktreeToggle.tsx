"use client";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/store";
import { useRunWorktreeStore } from "@/store/runWorktreeStore";

/** Lets the next harness run work in a worktree of its own, so your folder is not touched while it runs. */
export function WorktreeToggle({ disabled = false }: { disabled?: boolean }) {
  const t = useT();
  const enabled = useRunWorktreeStore((s) => s.enabled);
  const setEnabled = useRunWorktreeStore((s) => s.setEnabled);
  return (
    <Button
      size="sm"
      variant="ghost"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => setEnabled(!enabled)}
      title={t("chat.worktree.title")}
    >
      {t(enabled ? "chat.worktree.on" : "chat.worktree.off")}
    </Button>
  );
}
