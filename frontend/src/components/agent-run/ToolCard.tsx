"use client";
import { PERMISSION_LABEL, isPermissionMode } from "@/lib/permissionMode";
import { useEffect, useState } from "react";
import { sendControl } from "./runClient";
import type { ToolCall } from "./types";
import { Button } from "@/components/ui";
import { readDisclosure, useReadDisclosureStore, type DisclosureConnection } from "./readDisclosure";

/* ── Tool card (chat tools broker, contract v1.1 §2.5–2.6) ─────────────────
   The approval card is the last line of defence the threat-model names (T5,
   approval fatigue): argv one item per line so nothing hides in a long
   string, the sentence that says what "exec" really is, and a high-risk
   label that changes the card's colour — never a blocker, always legible. */

type Decision = "approve" | "reject";

function stateOf(call: ToolCall): { label: string; tone: "signal" | "ok" | "fault" | "warn" | "mute" } {
  if (call.denied) return call.denied.reason === "rejected" ? { label: "rejected", tone: "fault" } : { label: call.denied.reason === "approval_timeout" ? "no answer" : call.denied.reason === "hook" ? "blocked by hook" : "blocked", tone: "fault" };
  if (call.simulated) return { label: "simulated", tone: "mute" };
  if (call.timedOut) return { label: "timeout", tone: "fault" };
  if (call.ok === false) return { label: "failed", tone: "fault" };
  if (call.ok === true) return { label: "done", tone: "ok" };
  if (call.approval?.decision === "approve") return { label: "approved", tone: "signal" };
  if (call.approval?.decision === "reject") return { label: "rejected", tone: "fault" };
  if (call.approval) return { label: "waiting for approval", tone: "warn" };
  return { label: "running", tone: "signal" };
}

const TONE: Record<string, string> = {
  signal: "var(--signal-text)", ok: "var(--ink-mute)", fault: "var(--fault-text)", warn: "var(--warn-text)", mute: "var(--ink-mute)",
};

/** Which mode let a command run unasked: the original Auto keeps its wording, a preset is named. */
function autoApprovedBy(mode: string): string {
  if (mode === "auto_workspace") return "workspace mode";
  return isPermissionMode(mode) ? `${PERMISSION_LABEL[mode]} preset` : "permission mode";
}

export function ToolCard({ call, runId, connection }: { call: ToolCall; runId: string | null; connection?: DisclosureConnection | null }) {
  const [sent, setSent] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  // First read result on a remote provider: this card claims the disclosure
  // for the session, later cards for the same provider see it as already said.
  const disclosure = readDisclosure(connection, call);
  const alreadyDisclosed = useReadDisclosureStore((s) => Boolean(connection && s.seen.includes(connection.provider)));
  const [claimedDisclosure, setClaimedDisclosure] = useState(() => disclosure != null && !alreadyDisclosed);
  useEffect(() => {
    if (!disclosure || claimedDisclosure || alreadyDisclosed || !connection) return;
    useReadDisclosureStore.getState().markDisclosed(connection.provider);
    setClaimedDisclosure(true);
  }, [alreadyDisclosed, claimedDisclosure, connection, disclosure]);
  useEffect(() => {
    if (claimedDisclosure && connection) useReadDisclosureStore.getState().markDisclosed(connection.provider);
  }, [claimedDisclosure, connection]);
  const pendingApproval = Boolean(call.approval) && !call.approval?.decision && !call.denied;
  const high = call.approval?.risk === "high";
  const state = stateOf(call);
  const title = call.name === "exec" || call.name === "run_command" ? "Run command" : call.name === "read" || call.name === "read_file" ? "Read file" : call.name === "discover" || call.name === "list_workspace" ? "List workspace" : call.name;

  const decide = (decision: Decision) => {
    if (sent || !runId || !pendingApproval) return;
    setSent(decision);
    void sendControl(runId, { action: "resume", decision, call_id: call.callId, note });
  };

  return (
    <div
      className="mt-2 rounded-panel border bg-sub-200 p-3"
      style={{ borderColor: high ? "var(--fault)" : pendingApproval ? "var(--warn)" : "var(--line-soft)" }}
      data-tool-card={call.callId}
    >
      <div className="flex items-center gap-2">
        <span className="t-meta text-ink">{title}</span>
        {call.origin && <span className="t-meta text-ink-mute">· {call.origin === "model" ? "requested by the model" : "requested by you"}</span>}
        {call.autoApproved && <span data-auto-approved className="rounded-control bg-sub-300 px-1.5 py-0.5 text-meta text-ink-mute">auto-approved: {autoApprovedBy(call.autoApproved.mode)}</span>}
        {high && <span className="rounded-control px-1.5 py-0.5 text-meta font-semibold uppercase" style={{ background: "var(--fault)", color: "var(--fault-ink)" }}>high risk</span>}
        <span className="flex-1" />
        <span className="t-meta" style={{ color: TONE[state.tone] }}>{state.label}</span>
      </div>

      {call.argv ? (
        <ol className="mt-2 rounded-control bg-sub-100 px-3 py-2 font-mono text-body leading-5 text-ink" aria-label="argv">
          {call.argv.map((a, i) => <li key={i} className="whitespace-pre-wrap break-all">{a}</li>)}
        </ol>
      ) : call.path ? (
        <p className="mt-2 rounded-control bg-sub-100 px-3 py-2 font-mono text-body text-ink">{call.path}</p>
      ) : null}

      {high && call.approval?.riskHints.length ? (
        <p className="mt-1.5 text-body text-ink-mute">
          Risk pattern: {call.approval.riskHints.map((h) => <code key={h} data-hint className="mr-1 rounded bg-sub-100 px-1">{h}</code>)}
        </p>
      ) : null}

      {call.approval && (
        <p className="mt-1.5 text-body text-ink-mute">
          {call.approval.reason === "secret_pattern"
            ? "This path looks like it contains secrets. It is read only if you approve."
            : "This runs locally with your privileges; there is no system sandbox. It runs only if you approve."}
        </p>
      )}

      {pendingApproval && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={Boolean(sent) || !runId} onClick={() => decide("approve")}>Approve</Button>
          <Button disabled={Boolean(sent) || !runId} onClick={() => decide("reject")}>Reject</Button>
          <input value={note} onChange={(e) => setNote(e.target.value)} disabled={Boolean(sent)} placeholder="Note (optional, kept in the history)"
            aria-label="Decision note" className="h-control-md min-w-0 flex-1 rounded-control border border-line-strong bg-sub-100 px-2 text-body text-ink placeholder:text-ink-mute max-sm:h-control-lg" />
          {sent && <span className="t-meta text-ink-mute">sending…</span>}
        </div>
      )}

      {call.approval?.decision && call.approval.note ? <p className="mt-1 text-meta text-ink-mute">note: {call.approval.note}</p> : null}
      {call.hooks?.map((h) => (
        <p key={h.hookId} className="mt-1 text-meta text-ink-mute" data-hook-decision>
          hook {h.hookId}: {h.decision === "allow" ? "allowed" : `blocked (${h.reason.replace("_", " ")})`}
        </p>
      ))}
      {call.denied?.note ? <p className="mt-1 text-meta text-ink-mute">{call.denied.note}</p> : null}
      {claimedDisclosure && disclosure ? (
        <p className="mt-1.5 text-body text-ink-mute" data-read-disclosure>{disclosure}</p>
      ) : null}

      {(call.result || call.truncated || typeof call.exitCode === "number") && (
        <div className="mt-2">
          <div className="flex items-center gap-2 text-meta text-ink-mute">
            {typeof call.exitCode === "number" && <span>exit {call.exitCode}</span>}
            {call.truncated && <span style={{ color: "var(--warn-text)" }}>output truncated</span>}
            {call.redactions ? <span>{call.redactions} secret{call.redactions > 1 ? "s" : ""} redacted</span> : null}
            {call.result && call.result.length > 240 && (
              <button type="button" onClick={() => setOpen((v) => !v)} className="text-ink-mute hover:text-ink">{open ? "collapse" : "expand"}</button>
            )}
          </div>
          {call.result && (
            <pre className={"mt-1 overflow-x-auto rounded-control bg-sub-100 px-3 py-2 font-mono text-body leading-5 text-ink " + (open ? "" : "max-h-40 overflow-y-hidden")}>{call.result}</pre>
          )}
        </div>
      )}
    </div>
  );
}
