"use client";
import { Button } from "@/components/ui/Button";
import { useEffect, useRef, useState } from "react";
import css from "./agentRun.module.css";
import type { Segment } from "./types";

/**
 * The human-in-the-loop gate.
 *
 * This is the one place in the app where the machine stops and cannot continue
 * without a person, so it is the one place that gets hazard hatching and an
 * unmissable field. It is also the one place where a decision must survive:
 * once resolved the card collapses to a permanent line in the transcript
 * recording who let the run through and what they said, because "why did this
 * run proceed" is a question people ask days later.
 */
export function Gate({
  segment,
  onResolve,
}: {
  segment: Segment;
  onResolve: (decision: "approve" | "reject", note: string) => void;
}) {
  const gate = segment.gate;
  const [note, setNote] = useState("");
  const [showContext, setShowContext] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const open = segment.state === "gate" && !gate?.decision;

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!gate) return null;

  if (gate.decision) {
    const rejected = gate.decision === "reject";
    return (
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className="h-[9px] w-[2px] flex-none translate-y-[1px] rounded-none"
          style={{ background: rejected ? "var(--fault)" : "var(--ink-faint)" }}
          aria-hidden
        />
        <span className="t-body text-ink-mute">
          {rejected ? "Rejected" : "Approved"} by you
          {gate.note ? <span className="text-ink-dim"> — “{gate.note}”</span> : null}
        </span>
      </div>
    );
  }

  const preview = gate.context.trim();
  const short = preview.length > 260 && !showContext ? `${preview.slice(0, 260)}…` : preview;

  return (
    <div className="mt-2 overflow-hidden rounded-panel border border-line bg-sub-200">
      <div className={css.tape} aria-hidden />

      <div className="px-3 pb-3 pt-2.5">
        <div className="flex items-center gap-2">
          <span className="t-label" style={{ color: "var(--warn-text)" }}>
            human gate
          </span>
          <span className="t-meta text-ink-mute">the run is blocked here</span>
        </div>

        <p className="t-title mt-1.5 text-ink">{gate.question}</p>

        {preview && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowContext((v) => !v)}
              className="t-meta text-ink-mute underline-offset-2 hover:text-ink-dim hover:underline"
            >
              {showContext ? "hide" : "show"} what it is asking you to approve
            </button>
            {showContext && (
              <p className={`t-body mt-1.5 max-h-40 overflow-y-auto text-ink-mute ${css.prose}`}>
                {short}
              </p>
            )}
          </div>
        )}

        <textarea
          ref={ref}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              onResolve("approve", note.trim());
            }
          }}
          placeholder="Add a note for the record, or send it back with a correction…"
          className="oh-inset oh-focus-inner t-body mt-2.5 block w-full resize-none px-2 py-1.5 text-ink placeholder:text-ink-mute"
        />

        <div className="mt-2 flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => onResolve("approve", note.trim())}>
            Approve &amp; continue
            <kbd className="t-meta rounded-control border px-1" style={{ borderColor: "var(--signal-ink)", color: "var(--signal-ink)" }}>
              ⏎
            </kbd>
          </Button>
          <Button variant="danger" size="sm" onClick={() => onResolve("reject", note.trim())}>
            Reject &amp; end run
          </Button>
          <span className="t-meta ml-auto text-ink-mute">nothing downstream runs until you answer</span>
        </div>
      </div>
    </div>
  );
}
