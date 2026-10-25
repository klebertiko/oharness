"use client";
import { HarnessLibrary } from "@/components/harnesses/HarnessLibrary";
import { useShellStore } from "./shellStore";
import { openStudioBundle } from "@/lib/studio";
import { Sheet } from "@/components/ui";

/**
 * Studio's "Open .ohm": a sheet over the canvas, not a destination. Picking a
 * harness bundle is a step inside building one, so it never leaves Studio;
 * closing it (Escape, the scrim, or picking a bundle) drops you right back
 * where you were, with focus on the control that opened it.
 */
export function HarnessLibrarySheet() {
  const open = useShellStore((s) => s.libraryOpen);
  const setOpen = useShellStore((s) => s.setLibraryOpen);

  return (
    <Sheet open={open} onOpenChange={setOpen} title="Harness library" hideTitle className="h-[min(560px,80dvh)] w-[min(480px,calc(100vw-24px))]">
      <HarnessLibrary
        onPicked={(bundle) => {
          openStudioBundle(bundle);
          setOpen(false);
        }}
      />
    </Sheet>
  );
}
