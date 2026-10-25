"use client";
import { Button } from "@/components/ui/Button";
import { useCallback, useEffect, useRef, useState } from "react";
import { PenLine } from "lucide-react";
import { assistField } from "@/lib/copilot/api";
import type { AssistAction, AssistField, AssistNeighbour, AssistRequest, AssistResponse, RequestMode } from "@/lib/copilot/contract";
import { describeFailure } from "@/lib/copilot/errors";
import { findPort } from "@/lib/ports";
import { useAssistProvider } from "@/lib/copilot/useAssistProvider";
import { useCanvasStore } from "@/store/canvasStore";

/* Field assist (spec §3.3): draft, improve or review one free-text field —
   an agent's or skill's System Prompt, a gate's Checklist — inline in the
   Inspector. The person always sees the suggestion first; "Use this" is one
   undo step. The request is built here from an explicit allowlist, so nothing
   but descriptive text and graph shape can leave. */

const clip = (s: string, max: number) => (s.length <= max ? s : Array.from(s).slice(0, max).join(""));
const INTENT_MAX = 500;
const FOCUS_MAX = 1000;
const CURRENT_MAX = 8000;
const MAX_NOTES_SHOWN: Record<"result" | "review", number> = { result: 3, review: 5 };

type Phase = "idle" | "working" | "result" | "error";
interface Result {
  action: AssistAction;
  response: AssistResponse;
}

export interface AssistController {
  field: AssistField;
  open: boolean;
  setOpen: (v: boolean) => void;
  phase: Phase;
  seconds: number;
  intent: string;
  setIntent: (v: string) => void;
  hasText: boolean;
  disabled: boolean;
  result: Result | null;
  error: string | null;
  run: (action: AssistAction, focus?: string) => void;
  cancel: () => void;
  discard: () => void;
  use: () => void;
}

function buildRequest(
  nodeId: string,
  field: AssistField,
  action: AssistAction,
  intent: string,
  route: { mode: RequestMode; connectionId: string | null },
  focus?: string,
): AssistRequest | null {
  const { nodes, edges, harnessMeta } = useCanvasStore.getState();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = node.data;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const neighbours: AssistNeighbour[] = [];
  for (const e of edges) {
    if (neighbours.length >= 8) break;
    if (e.target === nodeId) {
      const other = byId.get(e.source);
      if (other) neighbours.push({ direction: "in", type: other.type, label: clip(other.data.label ?? "", 60), port: findPort(other.type, "out", e.sourceHandle)?.id ?? "out" });
    } else if (e.source === nodeId) {
      const other = byId.get(e.target);
      if (other) neighbours.push({ direction: "out", type: other.type, label: clip(other.data.label ?? "", 60), port: findPort(other.type, "in", e.targetHandle)?.id ?? "in" });
    }
  }

  const ids: Partial<Record<"roleId" | "skillId" | "gateId", string>> = {};
  for (const key of ["roleId", "skillId", "gateId"] as const) {
    const v = d[key];
    if (typeof v === "string" && v !== "") ids[key] = clip(v, 40);
  }
  const current = typeof d[field] === "string" ? (d[field] as string) : "";
  return {
    field,
    action,
    node: { type: node.type, label: clip(d.label ?? "", 60), ...ids },
    current: clip(current, CURRENT_MAX),
    ...(action === "draft" ? { intent: clip(intent.trim(), INTENT_MAX) } : {}),
    ...(action === "improve" && focus ? { focus: clip(focus, FOCUS_MAX) } : {}),
    neighbours,
    harnessName: clip(harnessMeta.name ?? "", 80),
    mode: route.mode,
    connection_id: route.connectionId,
  };
}

export function useFieldAssist(nodeId: string, field: AssistField): AssistController {
  const isRunning = useCanvasStore((s) => s.isRunning);
  // No provider quietly means the offline assistant; the backend tags the result with its source.
  const { mode, connectionId } = useAssistProvider();
  const hasText = useCanvasStore((s) => {
    const v = s.nodes.find((n) => n.id === nodeId)?.data[field];
    return typeof v === "string" && v.trim() !== "";
  });
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [intent, setIntent] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (phase !== "working") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    (action: AssistAction, focus?: string) => {
      const req = buildRequest(nodeId, field, action, intent, { mode, connectionId }, focus);
      if (!req) return;
      controller.current?.abort();
      const ctl = new AbortController();
      controller.current = ctl;
      setPhase("working");
      setResult(null);
      setError(null);
      assistField(req, ctl.signal).then(
        (response) => {
          if (ctl.signal.aborted) return;
          setResult({ action, response });
          setPhase("result");
        },
        (err) => {
          if (ctl.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
          setError(describeFailure(err, "assist").text);
          setPhase("error");
        },
      );
    },
    [nodeId, field, intent, mode, connectionId],
  );

  const cancel = () => {
    controller.current?.abort();
    setPhase("idle");
  };
  const discard = () => {
    setResult(null);
    setError(null);
    setPhase("idle");
  };
  const use = () => {
    const text = result?.response.text;
    if (typeof text !== "string") return;
    useCanvasStore.getState().commitNodeData(nodeId, { [field]: text });
    setIntent("");
    discard();
  };

  return { field, open, setOpen, phase, seconds, intent, setIntent, hasText, disabled: isRunning, result, error, run, cancel, discard, use };
}


export function AssistToggle({ ctl }: { ctl: AssistController }) {
  return (
    <button
      type="button"
      aria-expanded={ctl.open}
      disabled={ctl.disabled}
      title={ctl.disabled ? "Stop the run to edit this field" : undefined}
      onClick={() => ctl.setOpen(!ctl.open)}
      className="inline-flex h-5 items-center gap-1 rounded-control px-1.5 text-body text-ink-mute hover:bg-sub-300 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-40"
    >
      <PenLine size={12} aria-hidden />
      Assist
    </button>
  );
}

export function AssistRow({ ctl }: { ctl: AssistController }) {
  if (!ctl.open) return null;

  if (ctl.phase === "working") {
    return (
      <div role="status" className="mt-1.5 flex items-center gap-2">
        <span className="t-meta text-ink-mute">Working · {ctl.seconds}s</span>
        <Button size="sm" variant="secondary" onClick={ctl.cancel}>Cancel</Button>
      </div>
    );
  }

  if (ctl.phase === "result" && ctl.result) {
    const { action, response } = ctl.result;
    const review = action === "review";
    const notes = response.notes.slice(0, MAX_NOTES_SHOWN[review ? "review" : "result"]);
    return (
      <div className="mt-1.5 space-y-2">
        {typeof response.text === "string" && (
          <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap wrap-break-word rounded-float border border-line bg-sub-300 p-2.5 font-sans text-body leading-relaxed text-ink">{response.text}</pre>
        )}
        {response.source === "offline" && <span className="t-meta text-ink-mute">Offline draft</span>}
        {notes.length > 0 && (
          <ul className="space-y-0.5">
            {notes.map((n, i) => (
              <li key={i} className="t-body text-ink-mute">{n}</li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          {review ? (
            <Button size="sm" variant="primary" onClick={() => ctl.run("improve", response.notes.join("\n"))}>Improve with these</Button>
          ) : (
            <Button size="sm" variant="primary" onClick={ctl.use}>Use this</Button>
          )}
          <Button size="sm" variant="secondary" onClick={ctl.discard}>Discard</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      {ctl.phase === "error" && ctl.error && (
        <p role="alert" className="t-body text-fault-text">{ctl.error}</p>
      )}
      {ctl.hasText ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => ctl.run("improve")}>Improve</Button>
          <Button size="sm" variant="secondary" onClick={() => ctl.run("review")}>Review</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label="What should it do?"
            placeholder="What should it do?"
            maxLength={INTENT_MAX}
            value={ctl.intent}
            onChange={(e) => ctl.setIntent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ctl.intent.trim()) {
                e.preventDefault();
                ctl.run("draft");
              }
            }}
            className="h-control-md min-w-0 flex-1 rounded-control border border-line-strong bg-sub-200 px-2 text-title text-ink placeholder:text-ink-mute hover:bg-sub-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
          />
          <Button size="sm" variant="primary" disabled={!ctl.intent.trim()} onClick={() => ctl.run("draft")}>Draft</Button>
        </div>
      )}
    </div>
  );
}

/** Toggle and row stacked, for use outside a Field label row. */
export function FieldAssist({ nodeId, field }: { nodeId: string; field: AssistField }) {
  const ctl = useFieldAssist(nodeId, field);
  return (
    <div>
      <div className="flex justify-end">
        <AssistToggle ctl={ctl} />
      </div>
      <AssistRow ctl={ctl} />
    </div>
  );
}
