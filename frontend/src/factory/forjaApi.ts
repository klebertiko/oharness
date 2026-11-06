/**
 * The Forja's calls to the sidecar (`/factory/*`, ADRs 0053-0058). Decisions need the person's credential: the desktop shell hands it to the
 * webview as `window.__OH_HUMAN__` (ADR 0055) and it goes out as `x-oharness-human`; without it the sidecar answers 403 `human_only`, which
 * the screens turn into a plain sentence instead of a failure.
 */
import { apiUrl } from "@/lib/apiBase";
import type { FactoryAction, WorkItem, WorkItemArtifact, WorkItemEvent } from "./types";

declare global {
  interface Window {
    /** The person's credential, injected by the desktop shell (never persisted by the UI). */
    __OH_HUMAN__?: string;
  }
}

export class ForjaError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const human = typeof window !== "undefined" ? window.__OH_HUMAN__ : undefined;
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(human ? { "x-oharness-human": human } : {}), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body as { detail?: { code?: string; message?: string; errors?: unknown } }).detail ?? {};
    throw new ForjaError(res.status, detail.code ?? `http_${res.status}`, detail.message ?? res.statusText, detail.errors);
  }
  return body as T;
}

const json = (value: unknown): RequestInit => ({ body: JSON.stringify(value) });

export interface InboxEntry {
  id: string;
  type: "question" | "question_answered" | "spec_review" | "handoff_ready" | "blocked" | "failed";
  work_item_id: string;
  title: string;
  stage: string;
  status: string;
  since: string;
  summary: string;
  actions: string[];
  resolved: boolean;
}
export interface VersionRow { hash: string; kind: string; mode: string; percent: number | null; label: string | null; previous_hash: string | null; activated_by: string; activated_at: string }
export interface DefinitionState { stable: VersionRow | null; canary: VersionRow | null }
export interface Change { path: string; op: "added" | "removed" | "changed"; before: unknown; after: unknown }
export interface Validation { ok: boolean; hash: string | null; name: string | null; errors: { file: string; path: string; message: string }[]; active_hash: string | null; update_available: boolean; changes: Change[] }
export interface SecretRow { name: string; reference: string; updated_at: string }
export interface MemoryNote { id: string; text: string; origin: "human" | "agent"; pinned: boolean; reviewed: boolean; updated_at: string }
export type Metrics = Record<string, Record<string, unknown>> & { schemaVersion: number; window: string };

export const forjaApi = {
  items: (limit = 200) => call<{ items: WorkItem[] }>(`/factory/work-items?limit=${limit}`),
  item: (id: string) => call<WorkItem & { artifacts: WorkItemArtifact[]; runs: { run_id: string; stage: string; agent_id: string | null }[] }>(`/factory/work-items/${encodeURIComponent(id)}`),
  events: (id: string) => call<{ events: WorkItemEvent[] }>(`/factory/work-items/${encodeURIComponent(id)}/events?limit=100`),
  act: (id: string, body: { action: FactoryAction } & Record<string, unknown>) =>
    call<WorkItem>(`/factory/work-items/${encodeURIComponent(id)}/actions`, { method: "POST", ...json(body) }),
  inbox: (resolved = false) => call<{ entries: InboxEntry[]; count: number }>(`/factory/inbox?include_resolved=${resolved}`),
  resolveEntry: (id: string) => call<void>(`/factory/inbox/${encodeURIComponent(id)}/resolve`, { method: "POST" }),
  undoEntry: (id: string) => call<void>(`/factory/inbox/${encodeURIComponent(id)}/resolve`, { method: "DELETE" }),
  metrics: (window: string) => call<Metrics>(`/factory/metrics?window=${encodeURIComponent(window)}`),
  state: (factory: string) => call<DefinitionState>(`/factory/definition?factory_id=${encodeURIComponent(factory)}`),
  versions: (factory: string) => call<{ versions: VersionRow[] }>(`/factory/definition/versions?factory_id=${encodeURIComponent(factory)}`),
  version: (factory: string, hash: string) =>
    call<VersionRow & { definition: { agents: Record<string, unknown> } }>(`/factory/definition/versions/${hash}?factory_id=${encodeURIComponent(factory)}`),
  validate: (workspace: string) => call<Validation>("/factory/definition/validate", { method: "POST", ...json({ workspace }) }),
  activate: (body: { workspace: string; expected_hash: string; mode: "stable" | "canary"; percent?: number }) =>
    call<VersionRow>("/factory/definition/activate", { method: "POST", ...json(body) }),
  promote: (factory: string) => call<VersionRow>("/factory/definition/promote", { method: "POST", ...json({ factory_id: factory }) }),
  abort: (factory: string) => call<VersionRow>("/factory/definition/abort", { method: "POST", ...json({ factory_id: factory }) }),
  rollback: (factory: string) => call<VersionRow>("/factory/definition/rollback", { method: "POST", ...json({ factory_id: factory }) }),
  projects: () => call<{ projects: { id: string; name: string; rootPath: string }[] } | { id: string; name: string; rootPath: string }[]>("/cowork/projects"),
  secrets: () => call<{ secrets: SecretRow[] }>("/factory/secrets"),
  putSecret: (name: string, value: string) => call<{ name: string }>(`/factory/secrets/${encodeURIComponent(name)}`, { method: "PUT", ...json({ value }) }),
  deleteSecret: (name: string) => call<void>(`/factory/secrets/${encodeURIComponent(name)}`, { method: "DELETE" }),
  memory: (factory: string, agent: string) => call<{ notes: MemoryNote[] }>(`/factory/memory?factory_id=${encodeURIComponent(factory)}&agent_id=${encodeURIComponent(agent)}`),
  addNote: (factory: string, agent: string, text: string) => call<MemoryNote>("/factory/memory", { method: "POST", ...json({ factory_id: factory, agent_id: agent, text }) }),
  editNote: (id: string, patch: { text?: string; pinned?: boolean; reviewed?: boolean }) => call<MemoryNote>(`/factory/memory/${id}`, { method: "PATCH", ...json(patch) }),
  deleteNote: (id: string) => call<void>(`/factory/memory/${id}`, { method: "DELETE" }),
};
