/**
 * Runs API — past harness executions, from the FastAPI sidecar's
 * `/execute/logs` store. List + one detail; the sidecar keeps the last 50.
 */
import { apiUrl } from "@/lib/apiBase";

/** `failed` = the sidecar persisted a classified provider failure (DIRECT-HISTORY AC#4);
    `error` = the engine itself errored. Both are failures to a reader, kept apart for the log. */
export type RunStatus = "running" | "complete" | "error" | "failed" | "stopped" | "interrupted" | "pending" | "unknown";
export type RunSource = "direct" | "harness";

export interface RunLog {
  id: string;
  harnessId: string;
  harnessName: string;
  status: RunStatus;
  /** Chat turn without a harness graph (`/execute/direct`) vs. a harness run. */
  source: RunSource;
  startedAt: string | null;
  finishedAt: string | null;
}

export type RunCoverage = "complete" | "partial" | "legacy_unknown";
export interface RunArtifact {
  id: string;
  run_id: string;
  event_sequence: number;
  kind: string;
  name: string;
  version: number;
  media_type: string;
  sha256: string;
}

export interface RunLogDetail extends RunLog {
  coverage: RunCoverage;
  lastSequence: number | null;
  artifacts: RunArtifact[];
  /** The server's one rule for "can be continued"; the UI only reads it. */
  resumable?: boolean;
  /** The run this one continues, and the last event it had saved. */
  continuedFrom?: string | null;
  parentSequence?: number | null;
  continuations?: string[];
  /** Whatever the engine persisted for the run: node outputs, gate notes, etc. */
  result: Record<string, unknown>;
}

type RawLog = {
  id: string;
  harness_id: string;
  harness_name: string;
  status: string;
  source?: string;
  started_at: string | null;
  finished_at: string | null;
  result?: Record<string, unknown>;
  coverage?: RunCoverage;
  last_sequence?: number;
  artifacts?: RunArtifact[];
  resumable?: boolean;
  continued_from?: string | null;
  parent_sequence?: number | null;
  continuations?: string[];
};

function normalize(raw: RawLog): RunLogDetail {
  return {
    id: raw.id,
    harnessId: raw.harness_id,
    harnessName: raw.harness_name,
    status: (["running", "complete", "error", "failed", "stopped", "interrupted", "pending"].includes(raw.status)
      ? raw.status
      : "unknown") as RunStatus,
    source: raw.source === "direct" ? "direct" : "harness",
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
    result: raw.result ?? {},
    coverage: raw.coverage ?? "legacy_unknown",
    lastSequence: raw.last_sequence ?? null,
    artifacts: raw.artifacts ?? [],
    resumable: raw.resumable ?? false,
    continuedFrom: raw.continued_from ?? null,
    parentSequence: raw.parent_sequence ?? null,
    continuations: raw.continuations ?? [],
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface ContinuedRun {
  id: string;
  continuedFrom: string;
  parentSequence: number;
}

export const runsApi = {
  /** A new run linked to this one; the saved events of this run are not changed. */
  continueRun: async (id: string): Promise<ContinuedRun> => {
    const res = await fetch(apiUrl(`/execute/logs/${encodeURIComponent(id)}/continue`), { method: "POST", cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const raw = (await res.json()) as { id: string; continued_from: string; parent_sequence: number };
    return { id: raw.id, continuedFrom: raw.continued_from, parentSequence: raw.parent_sequence };
  },
  artifact: (runId: string, artifactId: string): Promise<RunArtifact & { content: unknown }> =>
    getJson(`/execute/logs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`),
  list: async (): Promise<RunLog[]> => (await getJson<RawLog[]>("/execute/logs")).map(normalize),
  get: async (id: string): Promise<RunLogDetail> =>
    normalize(await getJson<RawLog>(`/execute/logs/${encodeURIComponent(id)}`)),
};

/** Best-effort human text from a persisted run result, for the detail view. */
export function runResultText(result: Record<string, unknown>): string {
  for (const key of ["output", "summary", "text", "message"]) {
    const v = result[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const keys = Object.keys(result);
  return keys.length ? JSON.stringify(result, null, 2) : "";
}
