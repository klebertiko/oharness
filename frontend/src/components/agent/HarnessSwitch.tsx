"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Workflow } from "lucide-react";

import { splitHarnessName } from "@/components/harnesses/harnessLabel";
import { ComboAction, Combobox } from "@/components/ui/Combobox";
import { NO_HARNESS } from "@/lib/chatHarness";
import { NONE_ID, buildHarnessOptions } from "@/lib/harnessOptions";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessRecentStore } from "@/store/harnessRecentStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useChatHarness } from "./useChatHarness";

export type HarnessSwitchProps = {
  /** Kept for existing callers; the picker is always inline now. */
  embedded?: boolean;
  onOpenStudio?: () => void;
};

/**
 * "Which harness runs this chat" (ADR 0012), in the composer toolbar: a
 * compact trigger that names the harness, and a keyboard-first list that shows
 * identity and purpose only. "No harness" leads; a filter appears when the list
 * is long; recent choices lead a long list. The only way out is one Studio
 * action. Providers are never mentioned here — they live in Providers.
 */
export function HarnessSwitch({ onOpenStudio }: HarnessSwitchProps) {
  const hydrated = useHarnessSessionStore((s) => s.hydrated);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const hydrateSession = useHarnessSessionStore((s) => s.hydrate);

  const entries = useHarnessLibraryStore((s) => s.entries);
  const libraryHydrated = useHarnessLibraryStore((s) => s.hydrated);
  const libraryFailed = useHarnessLibraryStore((s) => s.failed);
  const hydrateLibrary = useHarnessLibraryStore((s) => s.hydrate);

  const recent = useHarnessRecentStore((s) => s.ids);
  const loadRecent = useHarnessRecentStore((s) => s.load);
  const chat = useChatHarness();

  const [sessionError, setSessionError] = useState(false);
  const failed = libraryFailed || sessionError;
  const retry = () => {
    setSessionError(false);
    void hydrateSession().catch(() => setSessionError(true));
    void hydrateLibrary().catch(() => undefined);
  };

  useEffect(() => {
    if (!hydrated) void hydrateSession().catch(() => setSessionError(true));
  }, [hydrated, hydrateSession]);
  useEffect(() => {
    if (!libraryHydrated) void hydrateLibrary().catch(() => undefined);
  }, [libraryHydrated, hydrateLibrary]);
  useEffect(() => loadRecent(), [loadRecent]);

  const studio = activeBundle?.manifest?.id ? { id: activeBundle.manifest.id, name: activeBundle.manifest.name || activeBundle.manifest.id } : null;
  const { options, searchable, harnessCount } = useMemo(
    () => buildHarnessOptions({ entries, status: chat.status, recent, studioActive: studio }),
    [entries, chat.status, recent, studio],
  );

  const bound = chat.binding.kind === "harness" ? chat.binding : null;
  const title = bound ? splitHarnessName(bound.name).title : "";
  const gone = chat.status.state === "missing";
  const label = !bound ? "No harness" : gone ? `${title} (unavailable)` : title;
  const status = libraryHydrated ? "ready" : failed ? "error" : "loading";

  const choose = (id: string) => {
    if (id === NONE_ID) return chat.choose(NO_HARNESS);
    const entry = entries.find((e) => e.id === id);
    const name = entry?.name ?? (activeBundle?.manifest?.id === id ? activeBundle.manifest.name || id : id);
    chat.choose({ kind: "harness", id, name });
  };

  return (
    <Combobox
      label="Harness"
      triggerLabel={`Harness: ${label}`}
      value={bound?.id ?? NONE_ID}
      options={options}
      onChange={choose}
      searchable={searchable}
      searchPlaceholder="Find a harness"
      status={status}
      loadingText="Loading harnesses…"
      errorText="Couldn't load harnesses."
      emptyText="No harness matches that."
      header={status === "ready" && harnessCount === 0 ? "No harnesses yet. Create one in Studio." : undefined}
      triggerClassName="h-control-md max-w-[260px] px-2.5 text-body font-medium text-ink-dim hover:text-ink max-sm:h-control-lg"
      trigger={
        <>
          <Workflow size={14} strokeWidth={1.8} className={gone ? "flex-none text-warn-text" : bound ? "flex-none text-signal-text" : "flex-none text-ink-mute"} aria-hidden />
          <span className={`min-w-0 truncate ${gone ? "text-warn-text" : ""}`}>{status === "loading" && !bound ? "Loading…" : label}</span>
          <ChevronDown size={13} strokeWidth={1.8} className="flex-none text-ink-mute" aria-hidden />
        </>
      }
      footer={({ close }) => (
        <>
          {status === "error" && <ComboAction onClick={retry}>Try again</ComboAction>}
          {onOpenStudio && (
            <ComboAction
              onClick={() => {
                close(false);
                onOpenStudio();
              }}
            >
              {chat.status.state === "ready" ? "Edit in Studio" : "Open Studio"}
            </ComboAction>
          )}
        </>
      )}
    />
  );
}
