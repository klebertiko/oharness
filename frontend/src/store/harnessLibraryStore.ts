"use client";

import { create } from "zustand";

import { apiUrl } from "@/lib/apiBase";
import {
  useHarnessSessionStore,
  type HarnessBundle,
} from "@/store/harnessSessionStore";

export const HARNESS_LIBRARY_KEY = "oh.harnessLibrary";
export const DEFAULT_BUNDLE_ID = "oharness.default.agile";

export interface LibraryEntry {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  bundle: HarnessBundle;
  addedAt: number;
}

interface LibraryPersisted {
  imports: Array<{
    id: string;
    name: string;
    description?: string;
    bundle: HarnessBundle;
    addedAt: number;
  }>;
}

export interface HarnessLibraryState {
  entries: LibraryEntry[];
  hydrated: boolean;
  /** The last hydrate failed; callers stop waiting and offer a retry. */
  failed: boolean;
  hydrate: () => Promise<void>;
  /** Add or replace a non-default entry. Default id is ignored (stays fetched). */
  importBundle: (bundle: HarnessBundle) => void;
  /** Activate → replaceBundle + setEnabled(true). */
  activate: (id: string) => void;
  remove: (id: string) => void;
}

function entryFromBundle(
  bundle: HarnessBundle,
  opts: { isDefault: boolean; addedAt?: number }
): LibraryEntry {
  const id = bundle.manifest.id;
  return {
    id,
    name: bundle.manifest.name || id,
    description:
      typeof bundle.manifest.description === "string"
        ? bundle.manifest.description
        : undefined,
    isDefault: opts.isDefault,
    bundle,
    addedAt: opts.addedAt ?? Date.now(),
  };
}

function readPersistedImports(): LibraryPersisted["imports"] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(HARNESS_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<LibraryPersisted>;
    if (!parsed || !Array.isArray(parsed.imports)) return [];
    return parsed.imports.filter(
      (row) =>
        row &&
        typeof row.id === "string" &&
        row.bundle?.manifest?.id &&
        row.id !== DEFAULT_BUNDLE_ID
    );
  } catch {
    return [];
  }
}

function writePersisted(entries: LibraryEntry[]): void {
  if (typeof localStorage === "undefined") return;
  const imports = entries
    .filter((e) => !e.isDefault && e.id !== DEFAULT_BUNDLE_ID)
    .map(({ id, name, description, bundle, addedAt }) => ({
      id,
      name,
      description,
      bundle,
      addedAt,
    }));
  const payload: LibraryPersisted = { imports };
  localStorage.setItem(HARNESS_LIBRARY_KEY, JSON.stringify(payload));
}

function mergeLibrary(
  defaultBundle: HarnessBundle,
  imports: LibraryPersisted["imports"]
): LibraryEntry[] {
  const defaultEntry = entryFromBundle(defaultBundle, {
    isDefault: true,
    addedAt: 0,
  });
  const imported = imports
    .filter((row) => row.id !== defaultEntry.id)
    .map((row) =>
      entryFromBundle(row.bundle, {
        isDefault: false,
        addedAt: typeof row.addedAt === "number" ? row.addedAt : Date.now(),
      })
    );
  return [defaultEntry, ...imported];
}

export const useHarnessLibraryStore = create<HarnessLibraryState>((set, get) => ({
  entries: [],
  hydrated: false,
  failed: false,

  hydrate: async () => {
    try {
      const res = await fetch(apiUrl("/bundles/default"), { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load default harness: ${res.status}`);
      }
      const bundle = (await res.json()) as HarnessBundle;
      if (!bundle?.manifest?.id) {
        throw new Error("Default harness missing manifest.id");
      }

      const entries = mergeLibrary(bundle, readPersistedImports());
      set({ entries, hydrated: true, failed: false });
      writePersisted(entries);
    } catch (err) {
      set({ failed: true });
      throw err;
    }
  },

  importBundle: (bundle) => {
    if (!bundle?.manifest?.id) {
      throw new Error("Bundle missing manifest.id");
    }
    if (bundle.manifest.id === DEFAULT_BUNDLE_ID) {
      // Default is always served from /bundles/default — keep that entry.
      return;
    }
    const next = entryFromBundle(bundle, { isDefault: false });
    const without = get().entries.filter((e) => e.id !== next.id);
    const defaultRow = without.find((e) => e.isDefault);
    const rest = without.filter((e) => !e.isDefault);
    const entries = defaultRow
      ? [defaultRow, next, ...rest]
      : [next, ...rest];
    set({ entries });
    writePersisted(entries);
  },

  activate: (id) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return;
    const session = useHarnessSessionStore.getState();
    session.replaceBundle(entry.bundle);
    session.setEnabled(true);
  },

  remove: (id) => {
    if (id === DEFAULT_BUNDLE_ID) return;
    const filtered = get().entries.filter(
      (e) => e.isDefault || e.id !== id
    );
    set({ entries: filtered });
    writePersisted(filtered);
  },
}));
