"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Workflow } from "lucide-react";

import { harnessSubtitle, splitHarnessName } from "@/components/harnesses/harnessLabel";
import { ComboAction, Combobox, type ComboOption } from "@/components/ui/Combobox";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { Button } from "@/components/ui/Button";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

export type HarnessSwitchProps = {
  /** Kept for existing callers; the picker is always inline now. */
  embedded?: boolean;
  onOpenStudio?: () => void;
};

/** Option id for "No harness" — no harness id can be empty. */
const NONE_ID = "";

/**
 * One control for "which harness runs this conversation", in the composer
 * toolbar. "No harness" is the first option rather than a separate on/off
 * switch, so choosing and enabling are one gesture. Built on the shared
 * Combobox (portalled, viewport-clamped, keyboard-first).
 */
export function HarnessSwitch({ onOpenStudio }: HarnessSwitchProps) {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const hydrated = useHarnessSessionStore((s) => s.hydrated);
  const setEnabled = useHarnessSessionStore((s) => s.setEnabled);
  const hydrateSession = useHarnessSessionStore((s) => s.hydrate);

  const entries = useHarnessLibraryStore((s) => s.entries);
  const libraryHydrated = useHarnessLibraryStore((s) => s.hydrated);
  const hydrateLibrary = useHarnessLibraryStore((s) => s.hydrate);
  const activate = useHarnessLibraryStore((s) => s.activate);

  const [error, setError] = useState("");
  const retry = () => {
    setError("");
    void hydrateSession().catch((err: Error) => setError(err.message));
    void hydrateLibrary().catch((err: Error) => setError(err.message));
  };

  useEffect(() => {
    if (!hydrated) void hydrateSession().catch((err: Error) => setError(err.message));
  }, [hydrated, hydrateSession]);

  useEffect(() => {
    if (!libraryHydrated) void hydrateLibrary().catch((err: Error) => setError(err.message));
  }, [libraryHydrated, hydrateLibrary]);

  const options = useMemo<ComboOption[]>(
    () => [
      { id: NONE_ID, label: "No harness", detail: "Direct conversation with the model" },
      ...entries.map((e) => ({ id: e.id, label: splitHarnessName(e.name).title, detail: harnessSubtitle(e) })),
      // A harness put in use from Studio (e.g. the sample) is not a library
      // entry; keep it selectable so the picker shows what is really running.
      ...(activeBundle?.manifest?.id && !entries.some((e) => e.id === activeBundle.manifest.id)
        ? [{ id: activeBundle.manifest.id, label: splitHarnessName(activeBundle.manifest.name || activeBundle.manifest.id).title, detail: "From Studio" }]
        : []),
    ],
    [entries, activeBundle],
  );

  const activeId = enabled ? (activeBundle?.manifest?.id ?? NONE_ID) : NONE_ID;
  const activeName = activeBundle?.manifest?.name || activeBundle?.manifest?.id;
  const label = !enabled ? "No harness" : activeName ? splitHarnessName(activeName).title : error ? "Harness unavailable" : hydrated ? "No harness" : "Loading…";

  const choose = (id: string) => {
    if (id === NONE_ID) {
      setEnabled(false);
    } else {
      activate(id);
      if (!enabled) setEnabled(true);
    }
  };

  return (
    <>
      <Combobox
        label="Harness"
        triggerLabel={`Harness: ${label}`}
        value={activeId}
        options={options}
        onChange={choose}
        status={libraryHydrated ? "ready" : error ? "error" : "loading"}
        loadingText="Loading harnesses…"
        errorText="Couldn't load harnesses."
        triggerClassName="h-control-md max-w-[260px] px-2.5 text-body font-medium text-ink-dim hover:text-ink max-sm:h-control-lg"
        trigger={
          <>
            <Workflow size={14} strokeWidth={1.8} className={enabled ? "flex-none text-signal-text" : "flex-none text-ink-mute"} aria-hidden />
            <span className="min-w-0 truncate">{label}</span>
            <ChevronDown size={13} strokeWidth={1.8} className="flex-none text-ink-mute" aria-hidden />
          </>
        }
        footer={
          onOpenStudio
            ? ({ close }) => (
                <>
                  {onOpenStudio && (
                    <ComboAction
                      onClick={() => {
                        close(false);
                        onOpenStudio();
                      }}
                    >
                      Edit in Studio
                    </ComboAction>
                  )}
                </>
              )
            : undefined
        }
      />
      {error && (
        <span role="alert" className="flex items-center gap-1 text-meta text-fault-text" title={error}>
          Couldn&apos;t load harnesses.
          <Button size="sm" variant="ghost" onClick={retry}>Retry</Button>
        </span>
      )}
    </>
  );
}
