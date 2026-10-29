import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useUsageStore } from "./usageStore";
import { usageApi, type UsageSummary } from "@/lib/usageApi";

vi.mock("@/lib/usageApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/usageApi")>("@/lib/usageApi");
  return { ...actual, usageApi: { summary: vi.fn(), setBudget: vi.fn(), getBudget: vi.fn() } };
});

const SUMMARY: UsageSummary = {
  totalTokens: 100_000,
  totalCostUsd: 0.9,
  unpricedTokens: 0,
  budget: { limitUsd: 10, spentUsd: 0.9, remainingUsd: 9.1, pct: 0.09, state: "ok" },
  byConnection: [{ connectionId: "anthropic", provider: "anthropic", tokensTotal: 100_000, costUsd: 0.9, unpricedTokens: 0 }],
  bySource: [{ source: "harness", tokensTotal: 100_000, costUsd: 0.9 }],
};

const initial = useUsageStore.getState();
beforeEach(() => {
  useUsageStore.setState(initial, true);
  vi.mocked(usageApi.summary).mockResolvedValue(SUMMARY);
});
afterEach(() => {
  vi.resetAllMocks();
});

it("hydrate() fetches once even when called repeatedly", async () => {
  await Promise.all([useUsageStore.getState().hydrate(), useUsageStore.getState().hydrate()]);
  expect(usageApi.summary).toHaveBeenCalledTimes(1);
  expect(useUsageStore.getState().summary).toEqual(SUMMARY);
});

it("refresh() always re-fetches", async () => {
  await useUsageStore.getState().hydrate();
  await useUsageStore.getState().refresh();
  expect(usageApi.summary).toHaveBeenCalledTimes(2);
});

it("a failed fetch records an honest error, not stale-looking success", async () => {
  vi.mocked(usageApi.summary).mockRejectedValueOnce(new Error("sidecar unreachable"));
  await useUsageStore.getState().hydrate();
  expect(useUsageStore.getState().error).toBe("sidecar unreachable");
  expect(useUsageStore.getState().summary).toBeNull();
});

it("setBudget() saves then refreshes the summary", async () => {
  vi.mocked(usageApi.setBudget).mockResolvedValue(SUMMARY.budget);
  await useUsageStore.getState().setBudget(10);
  expect(usageApi.setBudget).toHaveBeenCalledWith(10);
  expect(usageApi.summary).toHaveBeenCalledTimes(1);
  expect(useUsageStore.getState().summary).toEqual(SUMMARY);
});

it("a rejected setBudget records an error and does not refresh", async () => {
  vi.mocked(usageApi.setBudget).mockRejectedValueOnce(new Error("Budget must be zero or a positive USD amount."));
  await useUsageStore.getState().setBudget(-5);
  expect(useUsageStore.getState().budgetError).toBe("Budget must be zero or a positive USD amount.");
  expect(usageApi.summary).not.toHaveBeenCalled();
});

it.each([NaN, Infinity, -Infinity, -1])("rejects invalid budget %s before sending JSON", async (value) => {
  await useUsageStore.getState().setBudget(value);
  expect(usageApi.setBudget).not.toHaveBeenCalled();
  expect(useUsageStore.getState().budgetError).toBe("Budget must be zero or a positive USD amount.");
});
