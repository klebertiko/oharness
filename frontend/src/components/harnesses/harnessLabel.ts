import { DEFAULT_BUNDLE_ID } from "@/store/harnessLibraryStore";

/** Names saved before the rename carry a source: "OHarness Agile (skills-framework)" → title "OHarness Agile", source "skills-framework". */
export function splitHarnessName(name: string): { title: string; source?: string } {
  const m = name.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  return m ? { title: m[1], source: m[2] } : { title: name };
}

export function isBuiltInHarness(e: { id: string; isDefault?: boolean }): boolean {
  return Boolean(e.isDefault) || e.id === DEFAULT_BUNDLE_ID;
}

/** The one human line under a harness name: where it came from. */
export function harnessSubtitle(e: { id: string; name: string; isDefault?: boolean }): string {
  const { source } = splitHarnessName(e.name);
  return [isBuiltInHarness(e) ? "Built-in" : "Imported", source].filter(Boolean).join(" · ");
}
