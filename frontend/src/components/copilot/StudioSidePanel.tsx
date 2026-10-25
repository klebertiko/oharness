"use client";
import { useRef } from "react";
import { PropertiesPanel } from "@/components/sidebar/PropertiesPanel";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore } from "@/store/copilotStore";
import { CopilotPanel } from "./CopilotPanel";

const TABS = ["inspector", "copilot"] as const;

/** The Studio editor's right column: Inspector or Copilot, one at a time. */
export function StudioSidePanel() {
  const tab = useCopilotStore((s) => s.tab);
  const setTab = useCopilotStore((s) => s.setTab);
  const hasSelection = useCanvasStore((s) => s.selectedNodeId !== null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const label = (t: (typeof TABS)[number]) =>
    t === "copilot" ? "Nilo" : tab === "copilot" && hasSelection ? "Inspector · 1 selected" : "Inspector";

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next =
      e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length]
      : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length]
      : e.key === "Home" ? TABS[0]
      : e.key === "End" ? TABS[TABS.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Side panel" onKeyDown={onKeyDown} className="flex min-h-panelhead flex-none items-center gap-1 border-b border-line-soft bg-sub-100 px-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={`side-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="side-tabpanel"
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            className={`h-control-sm rounded-control px-2 text-body max-sm:h-control-lg ${
              tab === t ? "bg-sub-300 font-medium text-ink shadow-[inset_0_-2px_0_var(--signal)]" : "text-ink-mute hover:bg-sub-200 hover:text-ink"
            }`}
          >
            {label(t)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="side-tabpanel" aria-labelledby={`side-tab-${tab}`} className="min-h-0 flex-1">
        {tab === "copilot" ? <CopilotPanel /> : <PropertiesPanel />}
      </div>
    </div>
  );
}
