import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyRun, runReducer } from "./runReducer";
import { RunBudgetField } from "./RunBudgetField";
import { RUN_BUDGET_RULES, validateMaxTokens } from "./runBudgetRules";
import { axeViolations } from "@/test/axe";
import { useRunBudgetStore } from "@/store/runBudgetStore";

const sse = (state: typeof emptyRun, event: string, data: Record<string, unknown>) =>
  runReducer(state, { type: "sse", event, data });

describe("run budget state", () => {
  it("records every compaction with before and after tokens", () => {
    const s = sse(emptyRun, "context_compacted", { node_id: "direct", before_tokens: 900, after_tokens: 300 });
    expect(s.compactions).toEqual([{ beforeTokens: 900, afterTokens: 300 }]);
  });

  it("shows budget_exceeded explicitly and keeps the run stopped", () => {
    let s = sse(emptyRun, "budget_exceeded", { node_id: "direct", max_tokens: 500, used_tokens: 640 });
    s = sse(s, "harness_done", { status: "budget_exceeded", total_tokens: 640, nodes_run: 1 });
    expect(s.budget).toEqual({ maxTokens: 500, usedTokens: 640 });
    expect(s.status).toBe("stopped");
  });

  it("validates against the shared rules table", () => {
    expect(validateMaxTokens("")).toEqual({ ok: true, value: null });
    expect(validateMaxTokens(String(RUN_BUDGET_RULES.maxTokens.min))).toEqual({ ok: true, value: RUN_BUDGET_RULES.maxTokens.min });
    for (const bad of ["0", "-1", "1.5", "abc", String(RUN_BUDGET_RULES.maxTokens.max + 1)]) {
      expect(validateMaxTokens(bad).ok).toBe(false);
    }
  });
});

describe("RunBudgetField", () => {
  afterEach(() => {
    cleanup();
    useRunBudgetStore.setState({ maxTokens: null });
  });

  it("stores a valid ceiling and announces an invalid one", async () => {
    const user = userEvent.setup();
    render(<RunBudgetField />);
    const field = screen.getByRole("textbox", { name: "Token ceiling for this run" });
    await user.type(field, "5000");
    expect(useRunBudgetStore.getState().maxTokens).toBe(5000);
    await user.clear(field);
    await user.type(field, "7");
    expect(screen.getByRole("alert").textContent).toMatch(/at least/i);
    expect(screen.getByRole("alert").textContent).toMatch(/no ceiling/);
  });

  it("shows the stored ceiling again after a remount", () => {
    useRunBudgetStore.setState({ maxTokens: 5000 });
    render(<RunBudgetField />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("5000");
  });

  it("has no axe violations, with or without an error", async () => {
    const user = userEvent.setup();
    const { container } = render(<RunBudgetField />);
    expect(await axeViolations(container)).toEqual([]);
    await user.type(screen.getByRole("textbox"), "7");
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("persisted ceiling", () => {
  afterEach(() => {
    localStorage.clear();
    useRunBudgetStore.setState({ maxTokens: null });
  });

  it("is saved when set and checked again when read back", async () => {
    useRunBudgetStore.getState().setMaxTokens(5000);
    expect(JSON.parse(localStorage.getItem("oh.runBudget.v1") ?? "{}").state.maxTokens).toBe(5000);
    localStorage.setItem("oh.runBudget.v1", JSON.stringify({ state: { maxTokens: 3 }, version: 1 }));
    await useRunBudgetStore.persist.rehydrate();
    expect(useRunBudgetStore.getState().maxTokens).toBeNull(); // below the rules table: not trusted
    localStorage.setItem("oh.runBudget.v1", JSON.stringify({ state: { maxTokens: 7000 }, version: 1 }));
    await useRunBudgetStore.persist.rehydrate();
    expect(useRunBudgetStore.getState().maxTokens).toBe(7000);
  });
});
