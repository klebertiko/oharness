"use client";
import { create } from "zustand";
import { pluginsApi, PluginsError } from "@/components/plugins/pluginsApi";
import type { FetchRequest, FetchResult, HostStatus, NiloRequest, PluginIndex, PluginView } from "@/components/plugins/types";

export interface Problem {
  code: string;
  message: string;
}
type AddStep = "form" | "fetching" | "preview" | "installing" | "done";
interface AddFlow {
  step: AddStep;
  fetched: FetchResult | null;
  installed: PluginView | null;
  error: Problem | null;
}
interface Logs {
  id: string | null;
  lines: string[];
  loading: boolean;
  error: Problem | null;
}

interface Discover {
  phase: "idle" | "loading" | "ready" | "error";
  index: PluginIndex | null;
  error: Problem | null;
}

interface PluginsState {
  /** `loading` only until the first answer; after that a failed refresh keeps the list and sets `refreshError`. */
  phase: "loading" | "ready" | "error";
  status: HostStatus | null;
  plugins: PluginView[];
  refreshError: Problem | null;
  /** The last change that failed (toggle, remove), shown above the list. */
  actionError: Problem | null;
  busy: Record<string, boolean>;
  selectedId: string | null;
  logs: Logs;
  add: AddFlow;
  /** Install requests from Nilo still waiting for the person. */
  requests: NiloRequest[];
  /** Creator mode (Nilo gets the cordis_plugins tool); null until the sidecar answered. */
  creator: boolean | null;
  requestError: Problem | null;
  discover: Discover;
  load: () => Promise<void>;
  loadNilo: () => Promise<void>;
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  setCreator: (on: boolean) => Promise<void>;
  loadIndex: (url: string) => Promise<void>;
  toggle: (id: string, on: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  select: (id: string | null) => void;
  loadLogs: (id: string) => Promise<void>;
  fetchPackage: (request: FetchRequest) => Promise<void>;
  install: (accepted: boolean) => Promise<void>;
  resetAdd: () => void;
  clearActionError: () => void;
  reset: () => void;
}

const problem = (error: unknown): Problem =>
  error instanceof PluginsError ? { code: error.code, message: error.message } : { code: "unknown", message: error instanceof Error ? error.message : String(error) };

const emptyAdd = (): AddFlow => ({ step: "form", fetched: null, installed: null, error: null });
const emptyLogs = (): Logs => ({ id: null, lines: [], loading: false, error: null });
const emptyDiscover = (): Discover => ({ phase: "idle", index: null, error: null });
const initial = () => ({
  phase: "loading" as const, status: null, plugins: [], refreshError: null, actionError: null, busy: {}, selectedId: null, logs: emptyLogs(), add: emptyAdd(),
  requests: [] as NiloRequest[], creator: null as boolean | null, requestError: null, discover: emptyDiscover(),
});

let addRun = 0;
const unavailable =(error: unknown): boolean => error instanceof PluginsError && error.code === "cordis_unavailable";

export const usePluginsStore = create<PluginsState>((set, get) => ({
  ...initial(),

  async load() {
    const [status, list] = await Promise.allSettled([pluginsApi.status(), pluginsApi.list()]);
    // A host that is not running is a state to show with its reason, not a failure of the screen.
    const down = status.status === "rejected" && unavailable(status.reason);
    const failure = status.status === "rejected" && !down ? status.reason : list.status === "rejected" && !unavailable(list.reason) ? list.reason : null;
    if (failure) {
      if (get().phase === "ready") set({ refreshError: problem(failure) });
      else set({ phase: "error", refreshError: problem(failure) });
      return;
    }
    const nextStatus: HostStatus =
      status.status === "fulfilled"
        ? status.value
        : { state: "unavailable", reason: (status as PromiseRejectedResult).reason.message, restarts: 0, node: null, hostLog: [], plugins: 0 };
    set({ phase: "ready", refreshError: null, status: nextStatus, plugins: list.status === "fulfilled" ? list.value.plugins : [] });
  },

  async toggle(id, on) {
    set((s) => ({ busy: { ...s.busy, [id]: true }, actionError: null }));
    try {
      const next = await (on ? pluginsApi.enable(id) : pluginsApi.disable(id));
      set((s) => ({ plugins: s.plugins.map((p) => (p.id === id ? next : p)) }));
    } catch (error) {
      set({ actionError: problem(error) });
    } finally {
      set((s) => ({ busy: { ...s.busy, [id]: false } }));
    }
  },

  async remove(id) {
    set((s) => ({ busy: { ...s.busy, [id]: true }, actionError: null }));
    try {
      await pluginsApi.remove(id);
      set((s) => ({ plugins: s.plugins.filter((p) => p.id !== id), selectedId: s.selectedId === id ? null : s.selectedId, logs: s.logs.id === id ? emptyLogs() : s.logs }));
    } catch (error) {
      set({ actionError: problem(error) });
    } finally {
      set((s) => ({ busy: { ...s.busy, [id]: false } }));
    }
  },

  select: (id) => set({ selectedId: id, logs: emptyLogs() }),

  async loadLogs(id) {
    set((s) => ({ logs: { ...s.logs, id, loading: true, error: null } }));
    try {
      const { lines } = await pluginsApi.logs(id);
      if (get().logs.id === id) set({ logs: { id, lines, loading: false, error: null } });
    } catch (error) {
      if (get().logs.id === id) set((s) => ({ logs: { ...s.logs, loading: false, error: problem(error) } }));
    }
  },

  async fetchPackage(request) {
    const mine = ++addRun;
    set({ add: { ...emptyAdd(), step: "fetching" } });
    try {
      const fetched = await pluginsApi.fetchPackage(request);
      if (mine === addRun) set({ add: { ...emptyAdd(), step: "preview", fetched } });
    } catch (error) {
      if (mine === addRun) set({ add: { ...emptyAdd(), error: problem(error) } });
    }
  },

  async install(accepted) {
    const { add } = get();
    // Nothing is sent without the person's confirmation of the warning.
    if (!accepted || add.step !== "preview" || !add.fetched) return;
    const { fetched } = add;
    set({ add: { ...add, step: "installing", error: null } });
    try {
      const installed = await pluginsApi.install({
        fetch_id: fetched.fetchId,
        accept: true,
        digest: fetched.preview.digest,
        ...(fetched.preview.scripts.length > 0 ? { scripts: "do-not-run" as const } : {}),
      });
      set((s) => ({ add: { ...emptyAdd(), step: "done", fetched, installed }, plugins: [...s.plugins.filter((p) => p.id !== installed.id && p.name !== installed.name), installed] }));
    } catch (error) {
      set({ add: { ...add, step: "preview", error: problem(error) } });
    }
  },

  // Cancelling while the download runs drops its answer: the staged files are collected by the sidecar and nothing is installed.
  resetAdd: () => {
    addRun += 1;
    set({ add: emptyAdd() });
  },
  async loadNilo() {
    // An older sidecar without these routes is not an error of the screen: the section just stays empty.
    const [requests, creator] = await Promise.allSettled([pluginsApi.requests(), pluginsApi.creator()]);
    set({
      requests: requests.status === "fulfilled" ? requests.value.requests.filter((r) => r.status === "pending") : [],
      creator: creator.status === "fulfilled" ? creator.value.enabled : null,
    });
  },

  async approve(id) {
    set((s) => ({ busy: { ...s.busy, [id]: true }, requestError: null }));
    try {
      const { plugin } = await pluginsApi.approve(id);
      set((s) => ({ plugins: [...s.plugins.filter((p) => p.id !== plugin.id && p.name !== plugin.name), plugin] }));
    } catch (error) {
      set({ requestError: problem(error) });
    } finally {
      set((s) => ({ busy: { ...s.busy, [id]: false } }));
    }
    if (!get().requestError) await get().loadNilo();
  },

  async reject(id) {
    set((s) => ({ busy: { ...s.busy, [id]: true }, requestError: null }));
    try {
      await pluginsApi.reject(id);
      await get().loadNilo();
    } catch (error) {
      set({ requestError: problem(error) });
    } finally {
      set((s) => ({ busy: { ...s.busy, [id]: false } }));
    }
  },

  async setCreator(on) {
    set({ requestError: null });
    try {
      set({ creator: (await pluginsApi.setCreator(on)).enabled });
    } catch (error) {
      set({ requestError: problem(error) });
    }
  },

  async loadIndex(raw) {
    const url = raw.trim();
    if (!/^https:\/\/[^\s/]+/i.test(url)) {
      set({ discover: { phase: "error", index: null, error: { code: "invalid_url", message: "https" } } });
      return;
    }
    set({ discover: { phase: "loading", index: null, error: null } });
    try {
      set({ discover: { phase: "ready", index: await pluginsApi.fetchIndex(url), error: null } });
    } catch (error) {
      set({ discover: { phase: "error", index: null, error: problem(error) } });
    }
  },

  clearActionError: () => set({ actionError: null }),
  reset: () => set(initial()),
}));
