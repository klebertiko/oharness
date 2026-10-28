"use client";
import { useId, useState } from "react";
import { useRunBudgetStore } from "@/store/runBudgetStore";
import { validateMaxTokens } from "./runBudgetRules";

/** Token ceiling for the next run. A run that reaches it stops as `budget_exceeded`. */
export function RunBudgetField() {
  const id = useId();
  const setMaxTokens = useRunBudgetStore((s) => s.setMaxTokens);
  const stored = useRunBudgetStore((s) => s.maxTokens);
  const [text, setText] = useState(stored ? String(stored) : "");
  const [error, setError] = useState("");

  const onChange = (next: string) => {
    setText(next);
    const check = validateMaxTokens(next);
    // An invalid entry leaves the last valid ceiling in force; the message says so.
    if (check.ok) setMaxTokens(check.value);
    const current = useRunBudgetStore.getState().maxTokens;
    setError(check.ok ? "" : `${check.message} The run uses ${current ? `${current} tokens` : "no ceiling"}.`);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label htmlFor={id} className="text-meta text-ink-mute">Token ceiling</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder="none"
        aria-label="Token ceiling for this run"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="h-control-md w-24 rounded-control border border-line bg-transparent px-2 text-body text-ink-dim"
      />
      {error && (
        <span id={`${id}-err`} role="alert" className="text-meta text-fault-text">{error}</span>
      )}
    </div>
  );
}
