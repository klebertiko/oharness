/**
 * Open a run and pump its SSE frames at the caller.
 *
 * Production is a static Tauri export — there is no Next `/api/run` proxy.
 * Calls go straight to the FastAPI sidecar (`apiUrl` / `window.__OH_API__`).
 */

import { apiUrl } from "@/lib/apiBase";
import type { HarnessGraph } from "@/lib/types";
import type { PermissionMode } from "@/lib/permissionMode";

export interface StartRunPayload {
  graph_json?: HarnessGraph;
  harness_id?: string;
  mode: string;
  step: boolean;
  instruction?: string;
  /** Working folder for CLI-backed adapters — a Cowork project's `rootPath`.
      Omitted (not empty-string) when the person picked "No folder", so the
      backend's own `resolve_cwd()` fallback decides, not an empty path. */
  cwd?: string;
}

function pumpSse(
  url: string,
  payload: unknown,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  onClose: (err?: Error) => void
): () => void {
  const ctrl = new AbortController();

  (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line. Anything after the last
        // separator is a partial frame and stays in the buffer.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const name = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (!name || !data) continue;
          try {
            onEvent(name, JSON.parse(data));
          } catch {
            /* a frame we cannot parse is dropped, not fatal */
          }
        }
      }
      onClose();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") onClose();
      else onClose(err as Error);
    }
  })();

  return () => ctrl.abort();
}

export function startRun(
  payload: StartRunPayload,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  onClose: (err?: Error) => void
): () => void {
  return pumpSse(apiUrl("/execute/"), payload, onEvent, onClose);
}

/** Contract v1.1 §2.4 — a user-chosen tool that runs before the model is called. */
export type ToolPresetPayload =
  | { name: "exec"; argv: string[]; cwd?: string; timeout_s?: number }
  | { name: "read"; path: string; max_bytes?: number; truncate?: boolean }
  | { name: "discover" };

export interface DirectRunPayload {
  connection_id?: string;
  instruction: string;
  mode: string;
  step?: boolean;
  adapter?: string;
  model?: string;
  cwd?: string;
  /** Chat tools broker (contract v1.1 §2.4). Absent → the run behaves exactly as before. */
  tools?: {
    enabled?: boolean;
    preset?: ToolPresetPayload;
    summarize?: boolean;
    /** Let the model hand tasks to cancellable subagents (#166). */
    subagents?: boolean;
    /** Conversation key. The sidecar looks up this thread's stored permission mode. */
    thread_id?: string;
    /** What the screen shows; the sidecar uses the stricter of this and the stored mode. */
    permission_mode?: PermissionMode;
  };
}

/** Harness-off path — one adapter turn via `/execute/direct`. */
export function startDirectRun(
  payload: DirectRunPayload,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  onClose: (err?: Error) => void
): () => void {
  return pumpSse(apiUrl("/execute/direct"), payload, onEvent, onClose);
}

export type ControlAction = "stop" | "step" | "resume" | "message";

export async function sendControl(
  runId: string,
  body: {
    action: ControlAction;
    decision?: "approve" | "reject";
    /** Required for tool decisions (contract §2.6); the backend answers 409 on mismatch. */
    call_id?: string;
    note?: string;
    text?: string;
  }
): Promise<void> {
  await fetch(apiUrl(`/execute/${encodeURIComponent(runId)}/control`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
