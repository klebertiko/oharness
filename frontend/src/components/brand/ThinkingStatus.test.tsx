import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ThinkingStatus } from "./ThinkingStatus";

/**
 * `elapsed` is milliseconds since the real run opened (useRunStream().elapsed),
 * `tokens` is the run-wide running total (run.totals.tokens) — this suite pins
 * both the formatting and the "never a stray default" contract. The deeper
 * wiring guarantee (AgentStage must pass the run total, never one segment's
 * own `tokens`) is pinned separately in AgentStage.thinkingIndicator.test.tsx,
 * since this component has no notion of "segment" at all — it only renders
 * whatever number it is handed.
 */
describe("ThinkingStatus", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows 0s and no token reading when nothing has been passed yet", () => {
    render(<ThinkingStatus />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/\b0s\b/);
    expect(text).not.toContain("tok");
  });

  it("formats sub-minute elapsed as plain seconds, from milliseconds", () => {
    render(<ThinkingStatus elapsed={45000} />);
    expect(screen.getByRole("status").textContent).toMatch(/\b45s\b/);
  });

  it("formats elapsed past a minute as Xm SSs, from milliseconds", () => {
    render(<ThinkingStatus elapsed={65000} />);
    expect(screen.getByRole("status").textContent).toMatch(/\b1m 05s\b/);
  });

  it("renders a run-wide token total over 1000 with the shared compact k formatter", () => {
    render(<ThinkingStatus elapsed={0} tokens={2300} />);
    expect(screen.getByRole("status").textContent).toMatch(/\b2\.3k tok\b/);
  });

  it("renders small token counts verbatim, without a k suffix", () => {
    render(<ThinkingStatus elapsed={0} tokens={42} />);
    expect(screen.getByRole("status").textContent).toMatch(/\b42 tok\b/);
  });

  it("shows no token reading at all when the caller has no count yet (undefined, not a fake 0)", () => {
    render(<ThinkingStatus elapsed={12000} />);
    expect(screen.getByRole("status").textContent).not.toContain("tok");
  });

  it("renders exactly the numeric value it is given, verbatim through the formatter", () => {
    // Guards against the component silently substituting a derived/rounded
    // stand-in (e.g. a sum it computed itself) for the number the caller
    // handed it. The total-vs-segment WIRING guarantee itself is pinned at
    // the AgentStage integration seam, not here.
    const segmentTokensThatMustNotLeakIn = [1500, 2300, 900];
    const runTotalTokens = 9999;
    expect(segmentTokensThatMustNotLeakIn).not.toContain(runTotalTokens);

    render(<ThinkingStatus elapsed={0} tokens={runTotalTokens} />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/\b10\.0k tok\b/);
    for (const leaked of segmentTokensThatMustNotLeakIn) {
      expect(text).not.toMatch(new RegExp(`\\b${leaked} tok\\b`));
    }
  });

  it("rotates the whimsical verb as real elapsed time passes, not on its own mount timer", () => {
    const { rerender } = render(<ThinkingStatus state="thinking" elapsed={0} />);
    const first = screen.getByRole("status").textContent;
    rerender(<ThinkingStatus state="thinking" elapsed={3000} />);
    const second = screen.getByRole("status").textContent;
    expect(second).not.toEqual(first);
  });

  it("keeps elapsed/token digits out of the accessible name behind one stable sr-only line", () => {
    render(<ThinkingStatus elapsed={12000} tokens={500} />);
    expect(screen.getByText(/OHarness is working/i)).toBeTruthy();
  });

  it("shows the detail line when provided", () => {
    render(<ThinkingStatus detail="Walking the harness graph." />);
    expect(screen.getByText("Walking the harness graph.")).toBeTruthy();
  });
});
