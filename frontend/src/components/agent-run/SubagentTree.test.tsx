import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyRun, runReducer } from "./runReducer";
import { SubagentTree } from "./SubagentTree";
import { subagentApi } from "@/lib/subagentApi";
import { axeViolations } from "@/test/axe";
import type { RunState } from "./types";

const sse = (state: RunState, event: string, data: Record<string, unknown>) => runReducer(state, { type: "sse", event, data });

describe("subagent state in the run", () => {
  it("tracks each child from start to done, live", () => {
    let s = sse(emptyRun, "subagent_start", { child_id: "c1", parent_call_id: "k0", task: "alpha", state: "running" });
    s = sse(s, "subagent_start", { child_id: "c2", parent_call_id: "k1", task: "beta", state: "running" });
    s = sse(s, "subagent_progress", { child_id: "c1", chars: 420 });
    expect(s.subagents.map((c) => [c.id, c.state, c.chars])).toEqual([["c1", "running", 420], ["c2", "running", 0]]);
    s = sse(s, "subagent_done", { child_id: "c2", parent_call_id: "k1", state: "cancelled", chars: 10, tokens: 3 });
    expect(s.subagents.map((c) => c.state)).toEqual(["running", "cancelled"]);
    expect(s.status).not.toBe("stopped");
  });

  it("tells the person when the provider could not offer subagents", () => {
    const s = sse(emptyRun, "subagent_unavailable", { reason: "provider" });
    expect(s.notices).toEqual(["This provider runs its own tools, so the turn ran without subagents."]);
  });

  it("settles running children when the run stops, so none is left looking live", () => {
    let s = sse(emptyRun, "subagent_start", { child_id: "c1", parent_call_id: "k0", task: "alpha", state: "running" });
    s = sse(s, "run_stopped", {});
    expect(s.subagents[0].state).toBe("cancelled");
  });
});

describe("SubagentTree", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  const children = [
    { id: "c1", parentCallId: "k0", task: "alpha", state: "running", chars: 420, tokens: 0 },
    { id: "c2", parentCallId: "k1", task: "beta", state: "done", chars: 90, tokens: 12 },
  ] as never;

  it("shows the parent and every child with its state", () => {
    render(<SubagentTree runId="r1" runLive status="running" subagents={children} />);
    expect(screen.getByText("Nilo")).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getAllByText("running")).toHaveLength(2); // the parent turn and the running child
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("cancels exactly one running child, with the keyboard", async () => {
    const user = userEvent.setup();
    const cancel = vi.spyOn(subagentApi, "cancel").mockResolvedValue({ ok: true });
    render(<SubagentTree runId="r1" runLive status="running" subagents={children} />);
    expect(screen.queryByRole("button", { name: "Cancel subagent beta" })).toBeNull();
    const button = screen.getByRole("button", { name: "Cancel subagent alpha" });
    button.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("r1", "c1"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("says why a cancel did not go through", async () => {
    const user = userEvent.setup();
    const cancel = vi.spyOn(subagentApi, "cancel").mockResolvedValue({ ok: false, reason: "finished" });
    render(<SubagentTree runId="r1" runLive status="running" subagents={children} />);
    await user.click(screen.getByRole("button", { name: "Cancel subagent alpha" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already finished/);
    cancel.mockResolvedValue({ ok: false, reason: "failed" });
    await user.click(screen.getByRole("button", { name: "Cancel subagent alpha" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/did not go through/));
  });

  it("offers no cancel once the run is over, and has no axe violations", async () => {
    const { container, rerender } = render(<SubagentTree runId="r1" runLive status="running" subagents={children} />);
    expect(await axeViolations(container)).toEqual([]);
    rerender(<SubagentTree runId="r1" runLive={false} status="complete" subagents={children} />);
    expect(screen.queryByRole("button", { name: /Cancel subagent/ })).toBeNull();
  });

  it("speaks the chosen language", async () => {
    const { useLocaleStore } = await import("@/i18n/store");
    useLocaleStore.setState({ locale: "pt-BR" });
    try {
      render(<SubagentTree runId="r1" runLive status="running" subagents={children} />);
      expect(screen.getByRole("region", { name: "Subagentes" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancelar o subagente alpha" })).toBeTruthy();
      expect(screen.getByText("concluído")).toBeTruthy();
    } finally {
      useLocaleStore.setState({ locale: "en" });
    }
  });

  it("renders nothing without children", () => {
    const { container } = render(<SubagentTree runId="r1" runLive status="running" subagents={[]} />);
    expect(container.textContent).toBe("");
  });
});
