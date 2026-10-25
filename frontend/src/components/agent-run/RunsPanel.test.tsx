import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RunsPanel } from "./RunsPanel";

const runs = [
  {
    id: "r1",
    harnessId: "h1",
    harnessName: "OHarness Agile",
    status: "complete" as const,
    startedAt: new Date().toISOString(),
    finishedAt: new Date(Date.now() + 42_000).toISOString(),
    source: "harness" as const,
  },
  {
    id: "d1",
    harnessId: "",
    harnessName: "",
    status: "failed" as const,
    startedAt: new Date().toISOString(),
    finishedAt: new Date(Date.now() + 3_000).toISOString(),
    source: "direct" as const,
  },
];

vi.mock("@/lib/runsApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/runsApi")>()),
  runsApi: {
    list: vi.fn(async () => runs),
    get: vi.fn(async () => ({ ...runs[0], result: { output: "the plan ran" } })),
  },
}));

describe("RunsPanel", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("lists past runs with a human status and opens one for detail", async () => {
    const user = userEvent.setup();
    render(<RunsPanel />);

    const row = await screen.findByText("OHarness Agile");
    expect(screen.getByText(/Completed · 42s/)).toBeTruthy();

    await user.click(row);
    expect(await screen.findByText("the plan ran")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "All activity" }));
    expect(await screen.findByText("OHarness Agile")).toBeTruthy();
  });

  it("shows an honest empty state when there are no runs", async () => {
    const { runsApi } = await import("@/lib/runsApi");
    (runsApi.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    render(<RunsPanel />);
    expect(await screen.findByText("No activity yet.")).toBeTruthy();
  });

  it("tells a direct chat turn apart from a harness run and shows a persisted failure", async () => {
    render(<RunsPanel />);
    await screen.findByText("OHarness Agile");
    expect(screen.getByText("Direct chat")).toBeTruthy();
    expect(screen.getByText(/Direct · Failed · 3s/)).toBeTruthy();
  });
});
