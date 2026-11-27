"use client";
import { create } from "zustand";
import { pluginsApi, PluginsError } from "@/components/plugins/pluginsApi";
import type { FetchEvent, FetchRequest, FetchResult, HostStatus, NiloRequest, PluginIndex, PluginView } from "@/components/plugins/types";

export interface Problem {
  code: string;
  message: string;
}
type AddStep = "form" | "fetching" | "preview" | "installing" | "done";
interface AddFlow {
  step: AddStep;
  /** The sidecar's job for this download; set as soon as it answers. */
  fetchId: string | null;
  /** The steps the sidecar reported, in order; they stay visible through the preview and the install. */
  events: FetchEvent[];
  fetched: FetchResult | null;
  installed: PluginView | null;
  error: Problem | null;
  /** Set when the person chose not to install: the form says that nothing was installed. */
  notice: "declined" | null;
}
export type ScriptDecision = "accept" | "decline";
/** What the person decided for each lifecycle script of ONE package: `key` is the fetch and the digest of that review. */
interface ScriptDecisions {
  key: string | null;
  decisions: Record<string, ScriptDecision>;
}
/** How often a running download is read; the tests shorten it. */
export const fetchPolling = { intervalMs: 400 };
/** How often, and how many times, the screen asks a starting host whether it is up; the tests shorten it. */
export const hostPolling = { intervalMs: 1000, maxTries: 30 };
export const scriptKey = (fetchId: string, digest: string): string => `${fetchId}:${digest}`;

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
  scripts: ScriptDecisions;
  /** Install requests from Nilo still waiting for the person. */
  requests: NiloRequest[];
  /** Creator mode by chat thread: Nilo gets the cordis_plugins tool only in the threads where the person turned it on. */
  creatorByThread: Record<string, boolean>;
  requestError: Problem | null;
  discover: Discover;
  load: () => Promise<void>;
  loadNilo: () => Promise<void>;
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  loadCreator: (threadId: string) => Promise<void>;
  setCreator: (threadId: string, on: boolean) => Promise<void>;
  decideScript: (fetchId: string, digest: string, script: string, decision: ScriptDecision) => void;
  loadIndex: (url: string) => Promise<void>;
  toggle: (id: string, on: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  select: (id: string | null) => void;
  loadLogs: (id: string) => Promise<void>;
  fetchPackage: (request: FetchRequest) => Promise<void>;
  install: (accepted: boolean) => Promise<void>;
  resetAdd: () => void;
  declineAdd: () => Promise<void>;
  clearActionError: () => void;
  reset: () => void;
}

const problem = (error: unknown): Problem =>
  error instanceof PluginsError ? { code: error.code, message: error.message } : { code: "unknown", message: error instanceof Error ? error.message : String(error) };

const emptyAdd = (): AddFlow => ({ step: "form", fetchId: null, events: [], fetched: null, installed: null, error: null, notice: null });
const emptyScripts = (): ScriptDecisions => ({ key: null, decisions: {} });
const emptyLogs = (): Logs => ({ id: null, lines: [], loading: false, error: null });
const emptyDiscover = (): Discover => ({ phase: "idle", index: null, error: null });
const initial = () => ({
  phase: "loading" as const, status: null, plugins: [], refreshError: null, actionError: null, busy: {}, selectedId: null, logs: emptyLogs(), add: emptyAdd(),
  scripts: emptyScripts(), requests: [] as NiloRequest[], creatorByThread: {} as Record<string, boolean>, requestError: null, discover: emptyDiscover(),
});

let addRun = 0;
let addAbort: AbortController | null = null;
const unavailable = (error: unknown): boolean => error instanceof PluginsError && error.code === "cordis_unavailable";
const nap = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** True when every lifecycle script of this review was accepted (a package without scripts has nothing to decide). */
const scriptsAccepted = (scripts: ScriptDecisions, fetchId: string, digest: string, list: string[]): boolean =>
  list.length === 0 || (scripts.key === scriptKey(fetchId, digest) && list.every((name) => scripts.decisions[name] === "accept"));
/** Asks the sidecar to stop a download and delete what it staged; the person has already left, so a failure here changes nothing. */
const discardFetch = (fetchId: string) => {
  void pluginsApi.cancelFetch(fetchId).catch(() => undefined);
};

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
    addAbort?.abort();
    const abort = new AbortController();
    addAbort = abort;
    set({ add: { ...emptyAdd(), step: "fetching" }, scripts: emptyScripts() });
    const current = () => mine === addRun;
    try {
      let job = await pluginsApi.startFetch(request);
      // The person cancelled while the sidecar was answering: what it staged for this download goes with it.
      if (!current()) {
        discardFetch(job.fetchId);
        return;
      }
      set((s) => ({ add: { ...s.add, fetchId: job.fetchId, events: job.events } }));
      while (job.state === "running") {
        await nap(fetchPolling.intervalMs);
        if (!current()) return;
        job = await pluginsApi.fetchStatus(job.fetchId, abort.signal);
        if (!current()) return;
        set((s) => ({ add: { ...s.add, events: job.events } }));
      }
      if (job.state === "ready" && job.result) {
        const fetched = job.result;
        set((s) => ({ add: { ...s.add, step: "preview", fetched } }));
      } else if (job.state === "cancelled") set({ add: emptyAdd() });
      else set({ add: { ...emptyAdd(), error: job.error ?? { code: "fetch_failed", message: "" } } });
    } catch (error) {
      if (current() && !abort.signal.aborted) set({ add: { ...emptyAdd(), error: problem(error) } });
    }
  },

  decideScript(fetchId, digest, script, decision) {
    const key = scriptKey(fetchId, digest);
    // Decisions belong to one review: another fetch or another digest starts from nothing.
    set((s) => ({ scripts: { key, decisions: { ...(s.scripts.key === key ? s.scripts.decisions : {}), [script]: decision } } }));
  },

  async install(accepted) {
    const { add, scripts } = get();
    // Nothing is sent without the person's confirmation of the warning and a decision for each script.
    if (!accepted || add.step !== "preview" || !add.fetched) return;
    const { fetched } = add;
    const list = fetched.preview.scripts;
    if (!scriptsAccepted(scripts, fetched.fetchId, fetched.preview.digest, list)) return;
    set({ add: { ...add, step: "installing", error: null, events: [...add.events, { step: "installing", at: Date.now() / 1000 }] } });
    // The same token as the fetch: after a Cancel or a new add this install no longer owns the flow and writes nothing to it.
    const mine = addRun;
    const current = () => mine === addRun;
    try {
      const installed = await pluginsApi.install({
        fetch_id: fetched.fetchId,
        accept: true,
        digest: fetched.preview.digest,
        ...(list.length > 0 ? { scripts: "do-not-run" as const, scripts_accepted: list } : {}),
      });
      // The log's last word comes from the sidecar (installing, done); if it cannot be read the log keeps what it has.
      const last = await pluginsApi.fetchStatus(fetched.fetchId).catch(() => null);
      if (!current()) {
        // It was installed all the same: the list is read again from the sidecar instead of written from this old answer.
        void get().load();
        return;
      }
      set((s) => ({
        add: { ...emptyAdd(), step: "done", fetchId: fetched.fetchId, events: last ? last.events : [...add.events, { step: "done", at: Date.now() / 1000 }], fetched, installed },
        plugins: [...s.plugins.filter((p) => p.id !== installed.id && p.name !== installed.name), installed],
      }));
    } catch (error) {
      if (current()) set({ add: { ...add, step: "preview", error: problem(error) } });
    }
  },

  // Cancelling stops the polling and asks the sidecar to stop the download and delete what it staged (or to drop a preview nobody will install).
  resetAdd: () => {
    const { add } = get();
    addRun += 1;
    addAbort?.abort();
    addAbort = null;
    if (add.fetchId && (add.step === "fetching" || add.step === "preview")) discardFetch(add.fetchId);
    set({ add: emptyAdd(), scripts: emptyScripts() });
  },

  async declineAdd() {
    const { add } = get();
    addRun += 1;
    addAbort?.abort();
    addAbort = null;
    set({ add: { ...emptyAdd(), notice: "declined" }, scripts: emptyScripts() });
    if (add.fetchId) await pluginsApi.cancelFetch(add.fetchId).catch(() => undefined);
  },

  async loadNilo() {
    // An older sidecar without this route is not an error of the screen: the section just stays empty.
    const requests = await pluginsApi.requests().then(
      (r) => r.requests.filter((request) => request.status === "pending"),
      () => [] as NiloRequest[],
    );
    set({ requests });
  },

  async approve(id) {
    // The approval has no body: the sidecar installs the request's own preview, so the lock on its scripts is held here.
    const request = get().requests.find((r) => r.id === id);
    if (request && !scriptsAccepted(get().scripts, request.id, request.preview.digest, request.preview.scripts)) return;
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

  async loadCreator(threadId) {
    // A sidecar without creator mode just leaves the thread off.
    const answer = await pluginsApi.creator(threadId).catch(() => null);
    if (answer) set((s) => ({ creatorByThread: { ...s.creatorByThread, [threadId]: answer.enabled } }));
  },

  async setCreator(threadId, on) {
    set({ requestError: null });
    try {
      const answer = await pluginsApi.setCreator(threadId, on);
      set((s) => ({ creatorByThread: { ...s.creatorByThread, [threadId]: answer.enabled } }));
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
  reset: () => {
    addRun += 1;
    addAbort?.abort();
    addAbort = null;
    set(initial());
  },
}));
