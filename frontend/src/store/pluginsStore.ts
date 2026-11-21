"use client";

import { create } from "zustand";
import { PluginsError, pluginsClient } from "./pluginsClient";
import type { CreatorAction, InspectedPackage, MarketEntry, PluginView, PluginsClient, ShareResult, SourceRef } from "./pluginsTypes";

/** Tests replace the sidecar. The screen uses the real client. */
export const pluginsClientRef: { current: PluginsClient } = { current: pluginsClient };

export function bindPluginsClient(client: PluginsClient) {
  pluginsClientRef.current = client;
}

export type Phase = "idle" | "downloading" | "ready" | "installing" | "error";

interface PluginsState {
  phase: Phase;
  error: string | null;
  pending: InspectedPackage[];
  /** Keyed by fetch id. A decision never copies onto another package. */
  decisions: Record<string, "approve" | "reject">;
  activateNow: boolean;
  log: string[];
  installed: PluginView[];
  hostState: string;
  draft: string;
  sessionMode: "session" | "creator";
  /** Entering creator mode does not send the draft. This stays false. */
  messageSent: boolean;
  actions: CreatorAction[];
  lastResult: { name: string; version: string } | null;
  indexUrl: string;
  market: MarketEntry[];
  share: ShareResult | null;
  rowLogs: Record<string, string[]>;
  writtenFiles: string[];
  apis: { id: string; access: "read" }[];

  setDraft: (text: string) => void;
  enterCreatorMode: () => void;
  setActivateNow: (on: boolean) => void;
  inspect: (source: SourceRef) => Promise<void>;
  cancelDownload: () => boolean;
  decide: (fetchId: string, decision: "approve" | "reject") => void;
  dismissPending: (fetchId: string) => void;
  installPending: () => Promise<void>;
  approveAction: (id: string) => Promise<void>;
  rejectAction: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  loadMarket: (url: string) => Promise<void>;
  sharePlugin: (id: string, target: "npm" | "git") => Promise<void>;
  closeShare: () => void;
  loadLogs: (id: string) => Promise<void>;
  loadApis: () => Promise<void>;
  writeStarter: (folder: string, name: string) => Promise<string | null>;
}

const data = {
  phase: "idle" as Phase,
  error: null as string | null,
  pending: [] as InspectedPackage[],
  decisions: {} as Record<string, "approve" | "reject">,
  activateNow: true,
  log: [] as string[],
  installed: [] as PluginView[],
  hostState: "unknown",
  draft: "",
  sessionMode: "session" as const,
  messageSent: false,
  actions: [] as CreatorAction[],
  lastResult: null as { name: string; version: string } | null,
  indexUrl: "",
  market: [] as MarketEntry[],
  share: null as ShareResult | null,
  rowLogs: {} as Record<string, string[]>,
  writtenFiles: [] as string[],
  apis: [] as { id: string; access: "read" }[],
};

let seq = 0;
let inflight: AbortController | null = null;

function codeOf(error: unknown): string {
  if (error instanceof PluginsError) {
    if (error.code === "human_only") return "human";
    if (error.code === "cancelled") return "cancelled";
    if (error.code === "cordis_unavailable" || error.status === 503 || error.status === 502) return "offline";
    return "generic";
  }
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  return "offline";
}

function client(): PluginsClient {
  return pluginsClientRef.current;
}

export const usePluginsStore = create<PluginsState>((set, get) => ({
  ...data,
  market: [],

  setDraft: (text) => set({ draft: text }),

  enterCreatorMode: () => set({ sessionMode: "creator", messageSent: false }),

  setActivateNow: (on) => set({ activateNow: on }),

  inspect: async (source) => {
    inflight?.abort();
    const ac = new AbortController();
    inflight = ac;
    const token = ++seq;
    set({ phase: "downloading", error: null, log: ["downloading"] });
    try {
      const pkg = await client().fetch(source, ac.signal);
      if (token !== seq || ac.signal.aborted) {
        void client().discard(pkg.fetchId).catch(() => undefined);
        return;
      }
      set((s) => ({ phase: "ready", pending: [...s.pending, pkg], log: ["ready"] }));
    } catch (error) {
      if (token !== seq || ac.signal.aborted) return;
      set((s) => ({ phase: s.pending.length ? "ready" : "error", error: codeOf(error) }));
    }
  },

  /** True only while a download is in flight. After the package is inspected, cancelling the download no longer applies. */
  cancelDownload: () => {
    if (get().phase !== "downloading") return false;
    seq += 1;
    inflight?.abort();
    inflight = null;
    set((s) => ({ phase: s.pending.length ? "ready" : "idle", error: null, log: [] }));
    return true;
  },

  decide: (fetchId, decision) => {
    const pkg = get().pending.find((item) => item.fetchId === fetchId);
    if (!pkg || pkg.scripts.length === 0) return;
    set((s) => ({
      decisions: { ...s.decisions, [fetchId]: decision },
      error: s.error === "decide" ? null : s.error,
    }));
  },

  dismissPending: (fetchId) => {
    void client().discard(fetchId).catch(() => undefined);
    set((s) => {
      const pending = s.pending.filter((item) => item.fetchId !== fetchId);
      const { [fetchId]: _gone, ...decisions } = s.decisions;
      void _gone;
      return { pending, decisions, phase: pending.length ? "ready" : "idle" };
    });
  },

  installPending: async () => {
    const { pending, decisions, sessionMode, activateNow } = get();
    const undecided = pending.filter((pkg) => pkg.scripts.length > 0 && decisions[pkg.fetchId] !== "approve" && decisions[pkg.fetchId] !== "reject");
    if (undecided.length) {
      set({ error: "decide" });
      return;
    }
    const rejected = pending.filter((pkg) => decisions[pkg.fetchId] === "reject");
    const accepted = pending.filter((pkg) => decisions[pkg.fetchId] !== "reject");
    if (sessionMode === "creator") {
      const actions: CreatorAction[] = [];
      for (const pkg of accepted) {
        const action = await client().propose({
          fetchId: pkg.fetchId,
          digest: pkg.digest,
          summary: `${pkg.name} ${pkg.version}`,
          scripts: pkg.scripts.length ? "do-not-run" : null,
          name: pkg.name,
          version: pkg.version,
        });
        actions.push({ ...action, name: pkg.name, version: pkg.version, enable: activateNow, status: "pending" });
      }
      for (const pkg of rejected) void client().discard(pkg.fetchId).catch(() => undefined);
      set((s) => ({ actions: [...s.actions, ...actions], pending: [], decisions: {}, phase: "idle", error: null }));
      return;
    }
    for (const pkg of rejected) void client().discard(pkg.fetchId).catch(() => undefined);
    if (!accepted.length) {
      set({ pending: [], decisions: {}, phase: "idle", error: null });
      return;
    }
    set({ phase: "installing", log: [], error: null });
    const installed = [...get().installed];
    const left = [...accepted];
    try {
      for (const pkg of accepted) {
        const view = await client().install(
          {
            fetchId: pkg.fetchId,
            accept: true,
            digest: pkg.digest,
            enable: activateNow,
            ...(pkg.scripts.length ? { scripts: "do-not-run" as const } : {}),
          },
          (lines) => set({ log: lines }),
        );
        installed.unshift(view);
        left.shift();
      }
    } catch (error) {
      const ids = new Set(left.map((pkg) => pkg.fetchId));
      set((s) => ({
        phase: "error",
        error: codeOf(error),
        pending: left,
        installed,
        decisions: Object.fromEntries(Object.entries(s.decisions).filter(([id]) => ids.has(id))),
      }));
      return;
    }
    set({ phase: "idle", pending: [], decisions: {}, installed, error: null });
    await get().refresh();
  },

  approveAction: async (id) => {
    const action = get().actions.find((item) => item.id === id);
    if (!action || action.status !== "pending") return;
    set((s) => ({ actions: s.actions.map((item) => (item.id === id ? { ...item, status: "approving" } : item)), error: null }));
    try {
      const result = await client().decide(id, "approve", action.enable);
      set((s) => ({
        actions: s.actions.map((item) => (item.id === id ? { ...item, status: result.applied ? "approved" : "rejected" } : item)),
        installed: result.plugin ? [result.plugin, ...s.installed] : s.installed,
        lastResult: result.applied ? { name: action.name, version: action.version } : s.lastResult,
      }));
    } catch (error) {
      set((s) => ({
        actions: s.actions.map((item) => (item.id === id ? { ...item, status: "pending" } : item)),
        error: codeOf(error),
      }));
    }
  },

  rejectAction: async (id) => {
    const action = get().actions.find((item) => item.id === id);
    if (!action || action.status !== "pending") return;
    set((s) => ({ actions: s.actions.map((item) => (item.id === id ? { ...item, status: "rejected" } : item)) }));
    try {
      await client().decide(id, "reject", action.enable);
    } catch (error) {
      set((s) => ({
        actions: s.actions.map((item) => (item.id === id ? { ...item, status: "pending" } : item)),
        error: codeOf(error),
      }));
    }
  },

  refresh: async () => {
    try {
      const status = await client().status();
      let installed = get().installed;
      try {
        installed = await client().list();
      } catch {
        /* a failed refresh keeps the list already on screen */
      }
      set({ hostState: status.state, installed, error: get().error === "offline" ? null : get().error });
    } catch {
      set({ hostState: "offline", error: get().installed.length ? get().error : "offline" });
    }
  },

  setEnabled: async (id, enabled) => {
    try {
      const view = enabled ? await client().enable(id) : await client().disable(id);
      set((s) => ({ installed: s.installed.map((item) => (item.id === id ? view : item)), error: null }));
    } catch (error) {
      set({ error: codeOf(error) });
    }
  },

  remove: async (id) => {
    try {
      await client().remove(id);
      set((s) => ({ installed: s.installed.filter((item) => item.id !== id), error: null }));
    } catch (error) {
      set({ error: codeOf(error) });
    }
  },

  loadMarket: async (url) => {
    set({ indexUrl: url, error: null });
    try {
      const index = await client().marketplace(url);
      set({ market: index.plugins });
    } catch (error) {
      set({ error: codeOf(error) });
    }
  },

  sharePlugin: async (id, target) => {
    try {
      const share = await client().share(id, target);
      set({ share, error: null });
    } catch (error) {
      set({ error: codeOf(error) });
    }
  },

  closeShare: () => set({ share: null }),

  loadLogs: async (id) => {
    try {
      const lines = await client().logs(id);
      set((s) => ({ rowLogs: { ...s.rowLogs, [id]: lines } }));
    } catch (error) {
      set({ error: codeOf(error) });
    }
  },

  loadApis: async () => {
    try {
      const apis = await client().apis();
      set({ apis });
    } catch (error) {
      set({ error: codeOf(error) });
    }
  },

  writeStarter: async (folder, name) => {
    try {
      const written = await client().writeStarter(folder, name, get().draft);
      set({ writtenFiles: written.files, error: null });
      return written.path;
    } catch (error) {
      set({ error: codeOf(error) });
      return null;
    }
  },
}));

export function resetPluginsStore() {
  seq += 1;
  inflight?.abort();
  inflight = null;
  usePluginsStore.setState({ ...data, market: [] });
}
