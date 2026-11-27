"use client";

import { useEffect, useState } from "react";
import { Columns2, Rows2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/store";

const LAYOUT_KEY = "oh.dock.layout.v1";

type Split = "across" | "down" | null;

function loadSplit(): Split {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    return raw === "across" || raw === "down" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The right-hand host. Panels register later; until then the host shows the
 * slot it is given (the Studio inspector) or an empty state, with tabs and a
 * split the width of which the frame remembers.
 */
export function DockHost({ children, onClose }: { children?: React.ReactNode; onClose?: () => void }) {
  const t = useT();
  const [split, setSplit] = useState<Split>(null);
  const [active, setActive] = useState<"primary" | "second">("primary");

  useEffect(() => setSplit(loadSplit()), []);
  useEffect(() => {
    try {
      if (split) window.localStorage.setItem(LAYOUT_KEY, split);
      else window.localStorage.removeItem(LAYOUT_KEY);
    } catch {
      /* the split lasts for this session only */
    }
  }, [split]);

  const title = children ? t("shell.inspector") : t("shell.dock.label");

  return (
    <section aria-label={t("shell.dock.label")} className="flex h-full min-h-0 flex-col bg-sub-100">
      <div className="flex h-control-lg flex-none items-center gap-1 border-b border-line-soft px-1">
        <div role="tablist" aria-label={t("shell.dock.tabs")} className="flex min-w-0 flex-1 items-center gap-1">
          <Button role="tab" aria-selected={active === "primary"} size="sm" variant="ghost" className="max-w-full" onClick={() => setActive("primary")}>
            <span className="truncate">{title}</span>
          </Button>
          {split && (
            <Button role="tab" aria-selected={active === "second"} size="sm" variant="ghost" onClick={() => setActive("second")}>
              {t("shell.dock.label")}
            </Button>
          )}
        </div>
        <Button iconOnly size="sm" variant="ghost" aria-label={t("shell.dock.splitAcross")} icon={<Columns2 size={14} aria-hidden />} onClick={() => setSplit("across")} />
        <Button iconOnly size="sm" variant="ghost" aria-label={t("shell.dock.splitDown")} icon={<Rows2 size={14} aria-hidden />} onClick={() => setSplit("down")} />
        {split && (
          <Button iconOnly size="sm" variant="ghost" aria-label={t("shell.dock.closeSplit")} icon={<X size={14} aria-hidden />} onClick={() => setSplit(null)} />
        )}
        {onClose && <Button iconOnly size="sm" variant="ghost" aria-label={t("shell.dock.hide")} icon={<X size={14} aria-hidden />} onClick={onClose} />}
      </div>
      <div className={split === "down" ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1"}>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">{children ?? <p className="p-3 text-body text-ink-mute">{t("shell.dock.empty")}</p>}</div>
        {split && (
          <>
            <div className={split === "down" ? "h-px flex-none bg-line" : "w-px flex-none bg-line"} />
            <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3 text-body text-ink-mute">{t("shell.dock.empty")}</div>
          </>
        )}
      </div>
    </section>
  );
}
