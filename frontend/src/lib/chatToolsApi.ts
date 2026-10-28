/**
 * Chat tools broker client — contract v1.1
 * (.harness/sprint-2026-09-18/story-CHAT-TOOLS-CONTRACT/contract.md §2).
 *
 * Only the read-only half lives here (`capabilities`, `discover`, `read`).
 * `exec` is deliberately NOT a function: per contract §0.2 a command only
 * ever runs inside a `/execute/direct` run, parked on the run's approval
 * gate — see `agent-run/runClient.ts` (`tools.preset`) and `sendControl`.
 *
 * `apiUrl` already carries the sidecar bearer token (lib/apiBase.ts).
 */

import { apiUrl } from "@/lib/apiBase";

import type { PermissionMode } from "@/lib/permissionMode";

export type ProviderKind = "http" | "cli" | "mock";
export type CapabilityReason = "ok" | "no-workspace" | "cli-adapter" | "provider-no-tools" | "mock";

export interface ChatCapabilities {
  workspace: { root: string; name: string } | null;
  provider_kind: ProviderKind;
  /** Model-driven tool loop (contract §3). */
  tools: { discover: boolean; read: boolean; exec: boolean };
  /** User-chosen tools from the `/` menu (contract §2.4). */
  preset: { read: boolean; exec: boolean };
  reason: CapabilityReason;
  limits: {
    read_max_bytes: number;
    exec_timeout_s: number;
    exec_max_timeout_s: number;
    exec_output_max_bytes: number;
    max_tool_calls_per_turn: number;
    max_reads_per_turn: number;
  };
}

export type DiscoverItem =
  | { kind: "skill"; name: string; path: string; description?: string; source: string }
  | { kind: "command"; name: string; path: string; description?: string; argv?: string[]; cwd?: string; source: string };

export interface DiscoverResult {
  root: string;
  items: DiscoverItem[];
  truncated: boolean;
  scanned_dirs: number;
}

export interface ReadResult {
  path: string;
  bytes: number;
  truncated: boolean;
  encoding: string;
  content: string;
  redactions: number;
}

export interface TrustState {
  cwd: string;
  trusted: boolean;
}

export interface PermissionState {
  thread_id: string;
  mode: PermissionMode;
}

/** The plan a Plan-mode run ended in (waiting for approval). */
export interface PlanArtifact {
  plan_id: string;
  thread_id: string;
  text: string;
  status: "proposed";
}

/** Structured error body from the broker (contract §2.3). */
export class ChatToolsError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly path?: string) {
    super(`${code} (${status})`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    let at: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; path?: string };
      if (body?.error) code = body.error;
      at = body?.path;
    } catch {
      /* non-JSON error body — keep the status code */
    }
    throw new ChatToolsError(res.status, code, at);
  }
  return res.json() as Promise<T>;
}

export const chatToolsApi = {
  capabilities: (cwd: string, connectionId?: string) => {
    const q = new URLSearchParams({ cwd });
    if (connectionId) q.set("connection_id", connectionId);
    return request<ChatCapabilities>(`/chat/tools/capabilities?${q.toString()}`);
  },
  discover: (cwd: string) =>
    request<DiscoverResult>(`/chat/tools/discover?${new URLSearchParams({ cwd }).toString()}`),
  read: (cwd: string, path: string, opts?: { max_bytes?: number; truncate?: boolean }) =>
    request<ReadResult>("/chat/tools/read", {
      method: "POST",
      body: JSON.stringify({ cwd, path, ...opts }),
    }),
  /** Stored permission mode of a conversation (enforced by the sidecar; `ask` until set). */
  getPermission: (threadId: string) =>
    request<PermissionState>(`/chat/tools/permission?${new URLSearchParams({ thread_id: threadId }).toString()}`),
  /** Whether the person trusted this workspace (false until they say so). Enforced by the sidecar. */
  getTrust: (cwd: string) =>
    request<TrustState>(`/chat/tools/trust?${new URLSearchParams({ cwd }).toString()}`),
  setTrust: (cwd: string, trusted: boolean) =>
    request<TrustState>("/chat/tools/trust", { method: "PUT", body: JSON.stringify({ cwd, trusted }) }),
  /** The plan waiting for approval in this conversation, if any. */
  getPlan: (threadId: string) =>
    request<{ thread_id: string; plan: PlanArtifact | null }>(`/chat/tools/plan?${new URLSearchParams({ thread_id: threadId }).toString()}`),
  /** Approving leaves Plan mode (for Ask unless named) in the same step; only this call can. */
  approvePlan: (threadId: string, planId: string, mode?: PermissionMode) =>
    request<{ thread_id: string; plan_id: string; status: "approved"; mode: PermissionMode }>("/chat/tools/plan/approve", {
      method: "POST",
      body: JSON.stringify({ thread_id: threadId, plan_id: planId, ...(mode ? { mode } : {}) }),
    }),
  discardPlan: (threadId: string, planId: string) =>
    request<{ thread_id: string; plan_id: string; status: "discarded" }>("/chat/tools/plan/discard", {
      method: "POST",
      body: JSON.stringify({ thread_id: threadId, plan_id: planId }),
    }),
  setPermission: (threadId: string, mode: PermissionMode) =>
    request<PermissionState>("/chat/tools/permission", {
      method: "PUT",
      body: JSON.stringify({ thread_id: threadId, mode }),
    }),
};
