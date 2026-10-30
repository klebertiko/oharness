"use client";

import { create } from "zustand";

import { api } from "@/lib/api";
import { apiUrl } from "@/lib/apiBase";
import { bundleFromSavedRecord, stubBundleFromMeta } from "@/lib/savedHarnessBundle";
import type { HarnessMeta } from "@/lib/types";
import {
  useHarnessSessionStore,
  type HarnessBundle,
} from "@/store/harnessSessionStore";

export const HARNESS_LIBRARY_KEY = "oh.harnessLibrary";
export const DEFAULT_BUNDLE_ID = "oharness.default.agile";

export type LibrarySource = "bundled" | "saved" | "imported";

export interface LibraryEntry {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  /** Where it lives: the bundle served by the engine, a harness saved in Studio, or an imported .ohm. */
  source: LibrarySource;
  /** For a saved harness only the identity is held; `activate` fetches the graph. */
  bundle: HarnessBundle;
  addedAt: number;
}

type PersistedImport = {
  id: string;
  name: string;
  description?: string;
  bundle: HarnessBundle;
  addedAt: number;
};

interface LibraryPersisted {
  imports: PersistedImport[];
}

export interface HarnessLibraryState {
  entries: LibraryEntry[];
  imports: PersistedImport[];
  saved: HarnessMeta[];
  hydrated: boolean;
  /** The last hydrate failed; callers stop waiting and offer a retry. */
  failed: boolean;
  /** The saved-harness list could not be read; the rest of the library is still usable. */
  savedFailed: boolean;
  /** The saved harness whose graph could not be loaded when it was chosen. */
  activateFailed: { id: string; name: string } | null;
  /** The saved harness whose graph is being fetched right now. */
  activating: string | null;
  hydrate: () => Promise<void>;
  /** Studio's saved list changed (a save, rename or delete): follow it without a reload. */
  applySaved: (items: HarnessMeta[]) => void;
  /** Add or replace a non-default entry. Default id is ignored (stays fetched). */
  importBundle: (bundle: HarnessBundle) => void;
  /** Activate → replaceBundle + setEnabled(true). Resolves false when a saved harness couldn't be loaded. */
  activate: (id: string) => Promise<boolean>;
  /** The person chose something else: a load still in flight must not apply. */
  cancelActivation: () => void;
  /** Remove an imported entry. Saved harnesses are deleted from Studio, not here. */
  remove: (id: string) => void;
}

function entryFromBundle(
  bundle: HarnessBundle,
  opts: { source: LibrarySource; addedAt?: number }
): LibraryEntry {
  const id = bundle.manifest.id;
  return {
    id,
    name: bundle.manifest.name || id,
    description:
      typeof bundle.manifest.description === "string"
        ? bundle.manifest.description
        : undefined,
    isDefault: opts.source === "bundled",
    source: opts.source,
    bundle,
    addedAt: opts.addedAt ?? Date.now(),
  };
}

function readPersistedImports(): PersistedImport[] {
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

function writePersisted(imports: PersistedImport[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: LibraryPersisted = { imports };
    localStorage.setItem(HARNESS_LIBRARY_KEY, JSON.stringify(payload));
  } catch {
    /* storage full or blocked: imports last for this session only */
  }
}

const byName = (a: LibraryEntry, b: LibraryEntry) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

/**
 * The library, in a stable order: the bundled harness first, then everything
 * else by name (id breaks ties), whatever order the sources answered in.
 *
 * Precedence when one id appears in more than one source: the bundled default
 * (always served by the engine) > a harness saved in Studio (the database is
 * the source of truth) > an imported .ohm. The loser is hidden, not deleted, so
 * an import comes back if the saved harness is removed.
 */
export function mergeLibrary(
  defaultBundle: HarnessBundle,
  saved: HarnessMeta[],
  imports: PersistedImport[]
): LibraryEntry[] {
  const defaultEntry = entryFromBundle(defaultBundle, { source: "bundled", addedAt: 0 });
  const taken = new Set([defaultEntry.id]);
  const savedEntries = saved
    .filter((m) => m?.id && !taken.has(m.id) && taken.add(m.id))
    .map((m) => entryFromBundle(stubBundleFromMeta(m), { source: "saved", addedAt: Date.parse(m.created_at) || 0 }));
  const imported = imports
    .filter((row) => !taken.has(row.id) && taken.add(row.id))
    .map((row) =>
      entryFromBundle(row.bundle, {
        source: "imported",
        addedAt: typeof row.addedAt === "number" ? row.addedAt : Date.now(),
      })
    );
  return [defaultEntry, ...[...savedEntries, ...imported].sort(byName)];
}

/** One fetch at a time: the chat stage and the picker both ask on mount. */
let inflight: Promise<void> | null = null;
/** The newest activation wins when picks overlap. */
let activation = 0;
/** Bumped by every Studio list update, so a hydrate that raced one keeps the newer list. */
let savedRev = 0;

export const useHarnessLibraryStore = create<HarnessLibraryState>((set, get) => {
  const rebuild = (patch: Partial<HarnessLibraryState> = {}) => {
    const defaultRow = get().entries.find((e) => e.isDefault);
    if (!defaultRow) return set(patch);
    const next = { ...get(), ...patch };
    set({ ...patch, entries: mergeLibrary(defaultRow.bundle, next.saved, next.imports) });
  };

  const fetchSaved = async (): Promise<HarnessMeta[]> => {
    const list = await api.harnesses.list();
    if (!Array.isArray(list)) throw new Error("Saved harnesses came back in an unexpected shape.");
    return list;
  };

  return {
  entries: [],
  imports: [],
  saved: [],
  hydrated: false,
  failed: false,
  savedFailed: false,
  activateFailed: null,
  activating: null,

  hydrate: () => {
    inflight ??= (async () => {
      try {
        const rev = savedRev;
        const [res, saved] = await Promise.all([
          fetch(apiUrl("/bundles/default"), { cache: "no-store" }),
          fetchSaved().then((list) => ({ list }), () => null),
        ]);
        if (!res.ok) {
          throw new Error(`Failed to load default harness: ${res.status}`);
        }
        const bundle = (await res.json()) as HarnessBundle;
        if (!bundle?.manifest?.id) {
          throw new Error("Default harness missing manifest.id");
        }

        const imports = readPersistedImports();
        const list = saved && rev === savedRev ? saved.list : get().saved;
        set({
          entries: mergeLibrary(bundle, list, imports),
          imports,
          saved: list,
          hydrated: true,
          failed: false,
          savedFailed: !saved,
          activateFailed: null,
        });
        writePersisted(imports);
      } catch (err) {
        set({ failed: true });
        throw err;
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  },

  applySaved: (items) => {
    savedRev += 1;
    if (get().hydrated) rebuild({ saved: items, savedFailed: false });
    else set({ saved: items });
  },

  importBundle: (bundle) => {
    if (!bundle?.manifest?.id) {
      throw new Error("Bundle missing manifest.id");
    }
    if (bundle.manifest.id === DEFAULT_BUNDLE_ID) {
      // Default is always served from /bundles/default — keep that entry.
      return;
    }
    const row: PersistedImport = {
      id: bundle.manifest.id,
      name: bundle.manifest.name || bundle.manifest.id,
      description: typeof bundle.manifest.description === "string" ? bundle.manifest.description : undefined,
      bundle,
      addedAt: Date.now(),
    };
    const imports = [row, ...get().imports.filter((i) => i.id !== row.id)];
    rebuild({ imports });
    writePersisted(imports);
  },

  activate: async (id) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return false;
    const mine = ++activation;
    let bundle = entry.bundle;
    set({ activateFailed: null });
    if (entry.source === "saved") {
      set({ activating: id });
      try {
        bundle = bundleFromSavedRecord(await api.harnesses.get(id));
      } catch {
        if (mine === activation) set({ activateFailed: { id, name: entry.name }, activating: null });
        return false;
      }
      if (mine !== activation) return false;
      set({ activating: null });
    }
    const session = useHarnessSessionStore.getState();
    session.replaceBundle(bundle);
    session.setEnabled(true);
    return true;
  },

  cancelActivation: () => {
    activation += 1;
    set({ activating: null, activateFailed: null });
  },

  remove: (id) => {
    if (id === DEFAULT_BUNDLE_ID) return;
    const imports = get().imports.filter((i) => i.id !== id);
    rebuild({ imports });
    writePersisted(imports);
  },
  };
});
