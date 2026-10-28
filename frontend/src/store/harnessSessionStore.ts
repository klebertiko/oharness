"use client";

import { create } from "zustand";

import { apiUrl } from "@/lib/apiBase";

export const HARNESS_SESSION_KEY = "oh.harnessSession";

/** Session-held bundle — at least `manifest.id`; Studio import stores the full `.ohm`. */
export interface HarnessBundle {
  schemaVersion?: string;
  manifest: { id: string; name?: string; description?: string; [key: string]: unknown };
  graph?: { nodes: unknown[]; edges: unknown[] };
  content?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HarnessSessionPersisted {
  enabled: boolean;
  activeBundleId: string | null;
}

export interface HarnessSessionState {
  enabled: boolean;
  activeBundle: HarnessBundle | null;
  hydrated: boolean;
  setEnabled: (enabled: boolean) => void;
  setActiveBundle: (bundle: HarnessBundle | null) => void;
  replaceBundle: (bundle: HarnessBundle) => void;
  hydrate: () => Promise<void>;
}

function readPersisted(): Partial<HarnessSessionPersisted> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(HARNESS_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<HarnessSessionPersisted>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePersisted(enabled: boolean, activeBundleId: string | null): void {
  if (typeof localStorage === "undefined") return;
  const payload: HarnessSessionPersisted = { enabled, activeBundleId };
  localStorage.setItem(HARNESS_SESSION_KEY, JSON.stringify(payload));
}

function persistFromState(get: () => HarnessSessionState): void {
  const { enabled, activeBundle } = get();
  writePersisted(enabled, activeBundle?.manifest.id ?? null);
}

export const useHarnessSessionStore = create<HarnessSessionState>((set, get) => ({
  enabled: true,
  activeBundle: null,
  hydrated: false,

  setEnabled: (enabled) => {
    set({ enabled });
    persistFromState(get);
  },

  setActiveBundle: (bundle) => {
    set({ activeBundle: bundle });
    persistFromState(get);
  },

  replaceBundle: (bundle) => {
    set({ activeBundle: bundle });
    persistFromState(get);
  },

  hydrate: async () => {
    const persisted = readPersisted();
    const enabled =
      typeof persisted.enabled === "boolean" ? persisted.enabled : get().enabled;

    // A harness already put in use (Studio's "Use in chat" runs before the chat
    // ever mounts) is the person's choice; the packaged default must not
    // replace it just because the chat hydrates lazily afterwards.
    const current = get().activeBundle;
    if (current?.manifest?.id) {
      set({ enabled, hydrated: true });
      writePersisted(enabled, current.manifest.id);
      return;
    }

    const res = await fetch(apiUrl("/bundles/default"));
    if (!res.ok) {
      throw new Error(`Failed to load default harness: ${res.status}`);
    }
    const bundle = (await res.json()) as HarnessBundle;
    if (!bundle?.manifest?.id) {
      throw new Error("Default harness missing manifest.id");
    }

    // Someone put a harness in use while the default was loading: theirs wins.
    const chosen = get().activeBundle;
    if (chosen?.manifest?.id) {
      set({ enabled, hydrated: true });
      writePersisted(enabled, chosen.manifest.id);
      return;
    }

    set({
      enabled,
      activeBundle: bundle,
      hydrated: true,
    });
    writePersisted(enabled, bundle.manifest.id);
  },
}));
