/** Mirror of backend/run_budget.py RUN_BUDGET_RULES — pinned by test_run_budget_parity.py. */
export const RUN_BUDGET_RULES = {
  maxTokens: { min: 100, max: 10_000_000 },
  compactAtTokens: 24_000,
} as const;

export type MaxTokensCheck = { ok: true; value: number | null } | { ok: false; message: string };

/** Empty means no ceiling. Same range the sidecar enforces. */
export function validateMaxTokens(raw: string): MaxTokensCheck {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  const { min, max } = RUN_BUDGET_RULES.maxTokens;
  if (!/^\d+$/.test(text)) return { ok: false, message: "Enter a whole number of tokens." };
  const value = Number(text);
  if (value < min) return { ok: false, message: `Use at least ${min} tokens.` };
  if (value > max) return { ok: false, message: `Use at most ${max} tokens.` };
  return { ok: true, value };
}
