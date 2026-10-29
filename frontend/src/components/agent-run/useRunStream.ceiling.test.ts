import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startDirectRunMock = vi.fn();
const startRunMock = vi.fn();
vi.mock("./runClient", () => ({
  startDirectRun: (...args: unknown[]) => startDirectRunMock(...args),
  startRun: (...args: unknown[]) => startRunMock(...args),
  sendControl: vi.fn().mockResolvedValue(undefined),
}));

import { useUsageStore } from "@/components/providers/usageStore";
import { useRunBudgetStore } from "@/store/runBudgetStore";
import { useRunStream } from "./useRunStream";

const graph = { nodes: [], edges: [] };

function send(harnessEnabled: boolean) {
  const { result } = renderHook(() => useRunStream({ graph, harnessEnabled }));
  act(() => result.current.start({ instruction: "hi", mode: "live", step: false }));
  return (harnessEnabled ? startRunMock : startDirectRunMock).mock.calls.at(-1)![0] as Record<string, unknown>;
}

describe("the token ceiling reaches both run paths", () => {
  beforeEach(() => {
    startDirectRunMock.mockReset().mockReturnValue(vi.fn());
    startRunMock.mockReset().mockReturnValue(vi.fn());
    useUsageStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => useRunBudgetStore.setState({ maxTokens: null }));

  it("sends max_tokens with a harness-off turn and with a harness run", () => {
    useRunBudgetStore.setState({ maxTokens: 2500 });
    expect(send(false).max_tokens).toBe(2500);
    expect(send(true).max_tokens).toBe(2500);
  });

  it("sends nothing when no ceiling is set", () => {
    expect("max_tokens" in send(false)).toBe(false);
    expect("max_tokens" in send(true)).toBe(false);
  });
});
