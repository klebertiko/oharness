"use client";

import { Button } from "@/components/ui/Button";
import { useReducer, useRef, useState } from "react";
import { runsApi, type RunLogDetail } from "@/lib/runsApi";
import { useRunBudgetStore } from "@/store/runBudgetStore";
import { sendControl, startContinuedRun } from "./runClient";
import { emptyRun, runReducer } from "./runReducer";
import { Transcript } from "./Transcript";

const COVERAGE = {
  complete: "Complete history",
  partial: "Partial history — the run may have been interrupted.",
  legacy_unknown: "Legacy history — capture coverage is unknown.",
};

/** Output bodies are retrieved through the authenticated sidecar API, never filesystem links. */
export function RunEvidence({ detail, onContinued }: { detail: RunLogDetail; onContinued?: (runId: string) => void }) {
  const [contents, setContents] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [continued, setContinued] = useState<{ from: string; id: string; at: number } | null>(null);
  const [followed, dispatch] = useReducer(runReducer, emptyRun);
  const [following, setFollowing] = useState(false);
  const received = useRef(false);
  const inFlight = following && ["starting", "running", "gate", "paused"].includes(followed.status);
  const continueRun = async () => {
    setError("");
    let next: Awaited<ReturnType<typeof runsApi.continueRun>>;
    try {
      next = await runsApi.continueRun(detail.id);
    } catch {
      setError("Couldn't continue this run. Try again.");
      return;
    }
    setContinued({ from: detail.id, id: next.id, at: next.parentSequence });
    onContinued?.(next.id);
    dispatch({ type: "reset", mode: "mock", step: false });
    setFollowing(true);
    received.current = false;
    // The stream is not cancelled when this view goes away: closing it would stop the run on the server.
    startContinuedRun(
      next.id,
      (event, data) => {
        received.current = true;
        dispatch({ type: "sse", event, data });
      },
      (err) => {
        if (err && !received.current) {
          setError("Couldn't start the continued run. Open it from Runs to try again.");
          dispatch({ type: "clear" });
          setFollowing(false);
        } else if (err) {
          setError("The connection to the continued run dropped. Open it from Runs to see how far it got.");
        }
        onContinued?.(next.id);
      },
      useRunBudgetStore.getState().maxTokens,
    );
  };
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
      {detail.continuedFrom && <p>Continues run {detail.continuedFrom} from event {detail.parentSequence}.</p>}
      {detail.resumable && (
        <div className="space-y-1">
          <p>Continue this harness run as a new run; its saved events stay as they are.</p>
          <Button size="sm" variant="ghost" className="-ml-2" disabled={inFlight} onClick={() => void continueRun()}>
            Continue as a new run
          </Button>
        </div>
      )}
      {continued?.from === detail.id && <p role="status">New run created from event {continued.at} ({continued.id}).</p>}
      {following && continued?.from === detail.id && (
        <Transcript
          run={followed}
          onResolve={(decision, note) => void sendControl(continued.id, { action: "resume", decision, note })}
        />
      )}
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
