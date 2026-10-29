"use client";
import { create } from "zustand";
import { usageApi, type UsageSummary } from "@/lib/usageApi";

/**
 * Real usage + budget, read from the sidecar's ledger (backend/usage_
 * tracking.py via GET /usage/summary) — never computed here. Mirrors
 * providerStore.ts's hydrate-once pattern: the Providers screen's spend card and
 * its per-connection Activity panel both read this
 * one store so a budget change made in either place is instantly visible in
 * both, with one fetch instead of two independent ones.
 */

interface UsageState {
  summary: UsageSummary | null;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  /** The last budget save that failed (invalid amount or the sidecar refused), kept apart from `error` so a budget problem never reads as stale usage. */
  budgetError: string | null;

  /** Safe to call from every mounted consumer — only the first call fetches. */
  hydrate: () => Promise<void>;
  /** Force a re-fetch — call after a run completes or the budget changes. */
  refresh: () => Promise<void>;
  setBudget: (limitUsd: number | null) => Promise<boolean>;
}

async function load(set: (partial: Partial<UsageState>) => void): Promise<void> {
  set({ loading: true });
  try {
    const summary = await usageApi.summary();
    set({ summary, error: null, loading: false });
  } catch (err) {
    set({
      error: err instanceof Error ? err.message : "Could not reach the OHarness sidecar for usage.",
      loading: false,
    });
  }
}

export const useUsageStore = create<UsageState>((set, get) => ({
  summary: null,
  hydrated: false,
  loading: false,
  error: null,
  budgetError: null,

  hydrate: async () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    await load(set);
  },

  refresh: async () => {
    await load(set);
  },

  setBudget: async (limitUsd) => {
    if (limitUsd !== null && (!Number.isFinite(limitUsd) || limitUsd < 0)) {
      set({ budgetError: "Budget must be zero or a positive USD amount." });
      return false;
    }
    try {
      await usageApi.setBudget(limitUsd);
      set({ error: null, budgetError: null });
    } catch (err) {
      set({ budgetError: err instanceof Error ? err.message : "Could not save the budget." });
      return false;
    }
    await load(set);
    return true;
  },
}));

/** Completeness is backend evidence; a priced subtotal is not the total. Amounts are USD, formatted for the interface language. */
export function usageCostParts(
  usage: { costComplete?: boolean; estimatedCostUsd?: number | null },
  locale = "en-US",
): { kind: "unknown" } | { kind: "amount"; amount: string } {
  const cost = usage.estimatedCostUsd;
  if (usage.costComplete !== true || typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return { kind: "unknown" };
  const fmt = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumSignificantDigits: cost === 0 ? undefined : 4 });
  return { kind: "amount", amount: fmt.format(cost) };
}
