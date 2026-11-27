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
  type: "question" | "question_answered" | "spec_review" | "handoff_ready" | "blocked" | "failed" | "improvement";
  work_item_id: string;
  title: string;
  stage: string;
  status: string;
  since: string;
  summary: string;
  actions: string[];
  resolved: boolean;
  notice?: "pending" | "reverted";
  factory_id?: string;
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
  improvements: (factory?: string) => call<Improvements>(`/factory/improvements${factory ? `?factory_id=${encodeURIComponent(factory)}` : ""}`),
  runImprovement: (factoryId: string, force = false) => call<{ started: boolean; reason?: string | null; open?: number; proposal?: Proposal }>(`/factory/improvements/run`, { method: "POST", ...json({ factory_id: factoryId, force }) }),
  decideProposal: (id: string, action: "approve" | "request_changes" | "reject", note?: string) =>
    call<Proposal>(`/factory/improvements/${encodeURIComponent(id)}/decide`, { method: "POST", ...json({ action, note }) }),
  measureProposal: (id: string) => call<{ verdict: string | null }>(`/factory/improvements/${encodeURIComponent(id)}/measure`, { method: "POST" }),
  promoteProposal: (id: string) => call<Proposal>(`/factory/improvements/${encodeURIComponent(id)}/promoted`, { method: "POST" }),
  revertProposal: (id: string) => call<Proposal>(`/factory/improvements/${encodeURIComponent(id)}/revert`, { method: "POST" }),
  exportTrail: (factory?: string, afterId?: number | null) => {
    const query = new URLSearchParams();
    if (factory) query.set("factory_id", factory);
    if (afterId != null) query.set("after_id", String(afterId));
    const text = query.toString();
    return call<{ events: TrailEvent[]; next: number | null }>(`/factory/improvements/export${text ? `?${text}` : ""}`);
  },
};

export interface Proposal {
  id: string;
  factory_id: string;
  status: string;
  justification: string;
  target: "definition" | "code";
  failure_ids: string[];
  reasons: { code: string; path: string; message: string }[];
  verdict: string | null;
  estimated_tokens: number | null;
  diff: { path: string; op: string }[];
  created_at: string | null;
}
export interface FailureRow { id: string; agent_id: string | null; stage: string | null; reason: string; run_id: string | null; superseded: boolean; at: string | null }
export interface TrailEvent { id: number; type: string; at: string | null; proposal_id: string; actor?: { kind: string; id: string | null } }
export interface Improvements { proposals: Proposal[]; failures: FailureRow[]; events: TrailEvent[]; next?: number | null }
