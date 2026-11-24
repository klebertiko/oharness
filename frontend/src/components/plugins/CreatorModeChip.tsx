"use client";
import { Sparkles, X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { useThreadStore } from "@/store/threadStore";

/** A discreet chip in the composer while creator mode is on for the active thread; one click turns it off. Nothing shows when it is off. */
export function CreatorModeChip() {
  const t = useT();
  const threadId = useThreadStore((s) => s.activeThreadId);
  const on = usePluginsStore((s) => (threadId ? s.creatorByThread[threadId] === true : false));
  const loadCreator = usePluginsStore((s) => s.loadCreator);
  const setCreator = usePluginsStore((s) => s.setCreator);

  useEffect(() => {
    if (threadId) void loadCreator(threadId);
  }, [threadId, loadCreator]);

  if (!threadId || !on) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-control border border-line-strong px-2 text-meta text-ink-dim">
      <Sparkles size={12} aria-hidden />
      {t("plugins.creator.chip")}
      <Button size="sm" variant="ghost" iconOnly aria-label={t("plugins.creator.chipOff")} icon={<X size={12} aria-hidden />} onClick={() => void setCreator(threadId, false)} />
    </span>
  );
}
