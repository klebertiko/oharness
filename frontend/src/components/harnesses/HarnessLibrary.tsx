"use client";

import { Button } from "@/components/ui/Button";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Trash2, Upload, Workflow } from "lucide-react";

import { Panel } from "@/components/shell/Panel";
import { ListGroup, ListRow, RowAction } from "@/components/shell/ListRow";
import { isOHarnessBundle, validateBundle } from "@/lib/bundlesApi";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";
import { harnessSubtitle, isBuiltInHarness, splitHarnessName } from "./harnessLabel";

/**
 * The harness library — always lists the bundled Agile Harness, plus
 * imports. Clicking a row puts that harness in use; the full description is
 * on hover. `onPicked` lets the caller (Studio's sheet) close itself once a
 * choice is made, without this component knowing it's inside a sheet.
 */
export function HarnessLibrary({ onPicked }: { onPicked?: (bundle: HarnessBundle) => void } = {}) {
  const fileRef = useRef<HTMLInputElement>(null);
  // Harnesses saved in Studio are listed (and opened) on Studio's own overview; this is the bundled and imported set.
  const allEntries = useHarnessLibraryStore((s) => s.entries);
  const entries = useMemo(() => allEntries.filter((e) => e.source !== "saved"), [allEntries]);
  const hydrated = useHarnessLibraryStore((s) => s.hydrated);
  const hydrate = useHarnessLibraryStore((s) => s.hydrate);
  const importBundle = useHarnessLibraryStore((s) => s.importBundle);
  const activate = useHarnessLibraryStore((s) => s.activate);
  const remove = useHarnessLibraryStore((s) => s.remove);

  const activeId = useHarnessSessionStore((s) => s.activeBundle?.manifest.id ?? null);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hydrated) {
      void hydrate().catch((err: Error) => setError(err.message));
    }
  }, [hydrated, hydrate]);

  const onImportFile = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const result = await validateBundle(parsed);
      if (!result.ok) {
        setError(result.errors?.[0] || "Import failed validation");
        return;
      }
      if (!isOHarnessBundle(parsed)) {
        setError("Not a recognizable .ohm bundle");
        return;
      }
      importBundle(parsed as unknown as HarnessBundle);
      onPicked?.(parsed as unknown as HarnessBundle);
    } catch (err) {
      setError((err as Error).message || "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Panel
      title="Harnesses"
      className="h-full"
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".ohm,.oharness,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
          <Button size="sm" variant="ghost" disabled={busy} title="Import a .ohm file" onClick={() => fileRef.current?.click()} icon={<Upload size={13} strokeWidth={1.8} aria-hidden />}>
            Import
          </Button>
        </>
      }
    >
      {!hydrated && !error && <p className="px-4 py-3 text-body text-ink-mute">Loading harnesses…</p>}

      {error && (
        <p className="mx-3 mt-3 rounded-float bg-sub-200 px-3 py-2 text-body text-fault-text" role="alert">
          {error}
        </p>
      )}

      <ListGroup>
        {entries.map((entry) => {
          const active = entry.id === activeId;
          const removable = !isBuiltInHarness(entry);
          const { title } = splitHarnessName(entry.name);
          return (
            <ListRow
              key={entry.id}
              title={title}
              subtitle={harnessSubtitle(entry)}
              hint={entry.description}
              leading={
                <span
                  className={[
                    "grid h-8 w-8 flex-none place-items-center rounded-float bg-sub-200",
                    active ? "text-signal-text" : "text-ink-mute",
                  ].join(" ")}
                >
                  <Workflow size={15} strokeWidth={1.7} />
                </span>
              }
              onSelect={
                active && !onPicked
                  ? undefined
                  : () => {
                      if (onPicked) onPicked(entry.bundle);
                      else void activate(entry.id);
                    }
              }
              trailing={
                active ? (
                  <span className="inline-flex items-center gap-1 text-body font-medium text-signal-text">
                    <Check size={13} strokeWidth={2} />
                    {onPicked ? "Current" : "In use"}
                  </span>
                ) : undefined
              }
              actions={
                active && !removable ? undefined : (
                  <>
                    {!active && (
                      <RowAction
                        label={(onPicked ? "Open " : "Use ") + title}
                        onClick={() => {
                          if (onPicked) onPicked(entry.bundle);
                      else void activate(entry.id);
                        }}
                      >
                        {onPicked ? "Open" : "Use"}
                      </RowAction>
                    )}
                    {removable && (
                      <RowAction label={`Remove ${title}`} onClick={() => remove(entry.id)}>
                        <Trash2 size={13} strokeWidth={1.8} />
                      </RowAction>
                    )}
                  </>
                )
              }
            />
          );
        })}
      </ListGroup>
    </Panel>
  );
}
