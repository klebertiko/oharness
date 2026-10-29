"use client";
import { Button } from "@/components/ui";
import { useRunWorktreeStore } from "@/store/runWorktreeStore";

/** Lets the next harness run work in a worktree of its own, so your folder is not touched while it runs. */
export function WorktreeToggle({ disabled = false }: { disabled?: boolean }) {
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
      title="Run the harness in its own copy of your folder (a Git worktree). Your folder is not touched; changes the run leaves are kept on a rescue ref."
    >
      {`Own worktree ${enabled ? "on" : "off"}`}
    </Button>
  );
}
