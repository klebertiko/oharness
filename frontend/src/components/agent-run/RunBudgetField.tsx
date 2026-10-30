"use client";
import { useEffect, useId, useState } from "react";
import { useT } from "@/i18n/store";
import { useRunBudgetStore } from "@/store/runBudgetStore";
import { validateMaxTokens } from "./runBudgetRules";

/** Token ceiling for the next run. A run that reaches it stops as `budget_exceeded`. */
export function RunBudgetField() {
  const id = useId();
  const t = useT();
  const setMaxTokens = useRunBudgetStore((s) => s.setMaxTokens);
  const stored = useRunBudgetStore((s) => s.maxTokens);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  // Start empty so the first client render matches the static HTML, then show the remembered ceiling.
  useEffect(() => {
    setText((t) => (stored != null && t.trim() === "" ? String(stored) : t));
  }, [stored]);

  const onChange = (next: string) => {
    setText(next);
    const check = validateMaxTokens(next);
    // An invalid entry leaves the last valid ceiling in force; the message says so.
    if (check.ok) setMaxTokens(check.value);
    const current = useRunBudgetStore.getState().maxTokens;
    setError(check.ok ? "" : `${t(check.key, check.vars)} ${current ? t("run.ceiling.keepsTokens", { n: current }) : t("run.ceiling.keepsNone")}`);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label htmlFor={id} className="text-meta text-ink-mute">{t("run.ceiling.label")}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder={t("run.ceiling.none")}
        aria-label={t("run.ceiling.aria")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="h-control-md w-24 rounded-control border border-line-strong bg-transparent px-2 text-body text-ink-dim"
      />
      {error && (
        <span id={`${id}-err`} role="alert" className="text-meta text-fault-text">{error}</span>
      )}
    </div>
  );
}
