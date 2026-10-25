"use client";

import { Button } from "@/components/ui/Button";
import { useState } from "react";
import { runsApi, type RunLogDetail } from "@/lib/runsApi";

const COVERAGE = {
  complete: "Complete history",
  partial: "Partial history — the run may have been interrupted.",
  legacy_unknown: "Legacy history — capture coverage is unknown.",
};

/** Output bodies are retrieved through the authenticated sidecar API, never filesystem links. */
export function RunEvidence({ detail }: { detail: RunLogDetail }) {
  const [contents, setContents] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = async (id: string) => {
    setError("");
    try {
      const artifact = await runsApi.artifact(detail.id, id);
      const text = typeof artifact.content === "string" ? artifact.content : JSON.stringify(artifact.content, null, 2);
      setContents((old) => ({ ...old, [id]: text }));
    } catch {
      setError("Couldn't load this saved output. Try again.");
    }
  };
  const artifacts = detail.artifacts ?? [];
  return (
    <div className="mt-3 space-y-2 text-body text-ink-mute">
      <p>{COVERAGE[detail.coverage ?? "legacy_unknown"]}{detail.lastSequence != null ? ` · ${detail.lastSequence} events saved` : ""}</p>
      {detail.status === "interrupted" && <p>Interrupted — execution did not resume.</p>}
      {artifacts.length > 0 && <p className="font-medium text-ink">Saved outputs</p>}
      {artifacts.map((artifact) => (
        <div key={artifact.id}>
          <Button size="sm" variant="ghost" className="-ml-2" onClick={() => void load(artifact.id)}>
            {artifact.name} · v{artifact.version}
          </Button>
          {contents[artifact.id] !== undefined && (
            <pre className="mt-1 whitespace-pre-wrap rounded-control bg-sub-200 p-2 font-mono text-code">{contents[artifact.id]}</pre>
          )}
        </div>
      ))}
      {error && <p role="alert" className="text-fault-text">{error}</p>}
    </div>
  );
}
