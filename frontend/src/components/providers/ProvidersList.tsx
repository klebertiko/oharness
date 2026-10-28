"use client";
import { useEffect, useState } from "react";
import { isChatCapable, providerReadiness } from "@/components/agent/chatProvider";
import { ListGroup, ListRow, StatusDot, type Tone } from "@/components/shell/ListRow";
import { type ConnectionUsage } from "@/lib/usageApi";
import { Button, Notice } from "@/components/ui";
import { RESIDENCE_SR, ResidenceMark, ToneDot } from "./atoms";
import { nextStep } from "./nextStep";
import { useProviderStore, type Connection } from "./providerStore";
import { usageCostLabel, useUsageStore } from "./usageStore";

/**
 * Every connection this install holds, grouped by whether it can answer a
 * run right now — "Ready" above "Needs setup" — the same split the chat
 * combo groups its own rows by (`ChatProviderPicker.tsx`), so a connection
 * never wears a different status word, or sits in a differently-named
 * bucket, depending which surface you're looking at it from.
 *
 * This used to group by residence instead (did the prompt leave this
 * machine?) on the reasoning that residence is the property with a
 * consequence. That's still true, so it survives here as the small filled
 * / hollow mark on each row (`ResidenceMark`) rather than disappearing —
 * readiness answers "what can I use right now", residence answers "what am
 * I allowed to put in it", and a list grouped by the first still needs the
 * second visible per row.
 *
 * Credentials never appear here — only labels and health.
 * ADR 0001 § Consequences ¶6 (`docs/adr/0001-desktop-packaging.md`):
 * "Provider credentials must never reach the renderer." Refs live in
 * `secrets.ts` / the host vault; this panel is labels-only by construction.
 * Endpoints, probes and billing live in the dossier, one click away.
 */

/* "Agents only" holds delegation-only connections (Cursor) that are not set
   up: they have no chat adapter, so listing them under "Needs setup" next to
   the chat providers would read as a chat connection that failed to connect. */
const GROUPS: { key: "ready" | "needsSetup" | "agentsOnly"; label: string }[] = [
  { key: "ready", label: "Ready" },
  { key: "needsSetup", label: "Needs setup" },
  { key: "agentsOnly", label: "Agents only" },
];

const groupOf = (c: Connection): "ready" | "needsSetup" | "agentsOnly" =>
  providerReadiness(c).ready ? "ready" : isChatCapable(c) ? "needsSetup" : "agentsOnly";

/** Cost badge text for one connection's row — undefined (render nothing)
    when it has never actually been used, a genuinely different state from
    "used, but free" or "used, but unpriced" (both of which formatCost
    already tells apart honestly). */
function rowCostLabel(_c: Connection, usage: ConnectionUsage | undefined): string | undefined {
  if (!usage || usage.tokensTotal <= 0) return undefined;
  return usageCostLabel(usage);
}

function ProviderRow({
  c,
  usage,
  selected,
  onSelect,
}: {
  c: Connection;
  usage: ConnectionUsage | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const costLabel = rowCostLabel(c, usage);
  const readiness = providerReadiness(c);
  const step = nextStep(c);
  const status = step?.status ?? readiness.label;
  return (
    <ListRow
      title={c.label}
      subtitle={
        <>
          <span>{status}</span>
          {step && <span className="text-ink-mute"> · {step.hint}</span>}
        </>
      }
      hint={step ? `${status} — ${step.label}` : status}
      leading={<ToneDot tone={readiness.tone} />}
      selected={selected}
      onSelect={onSelect}
      trailing={
        <span className="flex items-center gap-2">
          <ResidenceMark residence={c.residence} />
          <span className="sr-only">{RESIDENCE_SR[c.residence]}</span>
          {costLabel && <span className="t-meta text-ink-mute">{costLabel}</span>}
        </span>
      }
    />
  );
}

const BUDGET_TONE_CLASS: Record<Tone, string> = {
  ok: "text-signal-text",
  warn: "text-warn-text",
  fault: "text-fault-text",
  idle: "text-ink-mute",
};

/** Global spend + budget — one line always visible, an inline editor one
    click away. Lives here (not the Dossier) because it is the one thing on
    this screen that is never about a single connection. */
function BudgetStrip() {
  const summary = useUsageStore((s) => s.summary);
  const loading = useUsageStore((s) => s.loading);
  const error = useUsageStore((s) => s.error);
  const setBudget = useUsageStore((s) => s.setBudget);
  const refreshUsage = useUsageStore((s) => s.refresh);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const budget = summary?.budget;
  const tone: Tone =
    !budget || budget.state === "unset" ? "idle" : budget.state === "ok" ? "ok" : budget.state === "warning" ? "warn" : "fault";

  const startEdit = () => {
    setDraft(budget?.limitUsd != null ? String(budget.limitUsd) : "");
    setInvalid(false);
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    const trimmed = draft.trim();
    const n = trimmed === "" ? null : Number(trimmed);
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSaving(true);
    try {
      if (await setBudget(n)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Spend and budget" className="mx-1.5 mt-2 rounded-float border border-line-soft bg-sub-100 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="t-body text-ink-mute">Spend</span>
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refreshUsage()} className="-my-1">
          Refresh usage
        </Button>
        <span className={`t-meta flex items-center gap-1.5 ${BUDGET_TONE_CLASS[tone]}`}>
          <StatusDot tone={tone} />
          {summary ? usageCostLabel(summary) : "—"}
        </span>
      </div>
      {loading && !summary && <p role="status" className="t-body text-ink-mute">Loading usage…</p>}
      {error && (
        <Notice tone="warn" role="alert" className="mt-2">
          Usage may be out of date. <span className="t-meta wrap-anywhere">{error}</span>
        </Notice>
      )}
      {editing ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            autoFocus
            disabled={saving}
            aria-invalid={invalid || undefined}
            aria-label="Global budget in USD"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="no limit"
            className="t-meta h-control-md w-full min-w-0 rounded-control border border-line-strong bg-sub-200 px-1.5 text-ink focus-visible:border-signal aria-invalid:border-fault max-sm:h-control-lg"
          />
          <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={startEdit} className="-ml-2 mt-0.5 text-ink-mute">
          {budget?.limitUsd != null
            ? `of $${budget.limitUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} budget`
            : "No budget — set one"}
        </Button>
      )}
      {editing && invalid && <p role="alert" className="mt-1 text-meta text-warn-text">Enter zero or a positive USD amount.</p>}
    </section>
  );
}

export function ProvidersList() {
  const { connections, selectedId, select } = useProviderStore();
  const hydrateUsage = useUsageStore((s) => s.hydrate);
  const usageByConnection = useUsageStore((s) => s.summary?.byConnection);

  useEffect(() => {
    void hydrateUsage();
  }, [hydrateUsage]);

  const usageFor = (id: string) => usageByConnection?.find((u) => u.connectionId === id);

  return (
    <div className="h-full min-h-0 overflow-y-auto pb-3">
      <BudgetStrip />
      {GROUPS.map((g) => {
        const rows = connections.filter((c) => groupOf(c) === g.key);
        if (!rows.length) return null;
        return (
          <ListGroup key={g.key} label={g.label}>
            {rows.map((c) => (
              <ProviderRow
                key={c.id}
                c={c}
                usage={usageFor(c.id)}
                selected={c.id === selectedId}
                onSelect={() => select(c.id)}
              />
            ))}
          </ListGroup>
        );
      })}
    </div>
  );
}
