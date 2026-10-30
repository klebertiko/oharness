import { apiUrl } from "@/lib/apiBase";

export type RevertResult = { ok: true } | { ok: false; code: string };

export const turnDiffApi = {
  /** Which recorded files were already reverted (for a run reopened from history). Unknown on any failure. */
  async state(runId: string): Promise<Record<string, boolean> | null> {
    try {
      const res = await fetch(apiUrl(`/execute/${encodeURIComponent(runId)}/turn-diff`), { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as { files?: { path: string; reverted: boolean }[] };
      return Object.fromEntries((body.files ?? []).map((f) => [f.path, Boolean(f.reverted)]));
    } catch {
      return null;
    }
  },

  /** Revert one file of a finished turn. The sidecar refuses anything that is not safe. */
  async revert(runId: string, path: string): Promise<RevertResult> {
    try {
      const res = await fetch(apiUrl(`/execute/${encodeURIComponent(runId)}/turn-diff/revert`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, code: body.error ?? String(res.status) };
    } catch {
      return { ok: false, code: "unreachable" };
    }
  },
};
