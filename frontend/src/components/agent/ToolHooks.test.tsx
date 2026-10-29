import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyRun, runReducer } from "@/components/agent-run/runReducer";
import { ToolCard } from "@/components/agent-run/ToolCard";
import { checkHook, HOOK_RULES } from "@/lib/toolHookRules";
import { toolHooksApi } from "@/lib/toolHooksApi";
import { axeViolations } from "@/test/axe";
import { ToolHooksButton } from "./ToolHooksSheet";

const draft = { id: "guard", program: "/usr/bin/audit", args: "--strict", timeoutS: "3", tools: ["exec"] };

describe("hook rules (shared with the sidecar validator)", () => {
  it("accepts a valid hook and builds the sidecar body", () => {
    expect(checkHook(draft)).toEqual({ ok: true, id: "guard", body: { argv: ["/usr/bin/audit", "--strict"], timeout_s: 3, tools: ["exec"] } });
  });
  it("refuses relative programs, shells, bad ids, timeouts and empty tool sets", () => {
    for (const bad of [
      { program: "audit" }, { program: "/bin/bash" }, { program: "C:\\Windows\\System32\\cmd.exe" }, { id: "A B" },
      { timeoutS: "0" }, { timeoutS: String(HOOK_RULES.timeoutS.max + 1) }, { tools: [] },
    ]) {
      expect(checkHook({ ...draft, ...bad }).ok).toBe(false);
    }
  });
});

describe("hook decisions in the run", () => {
  const started = runReducer(
    runReducer(emptyRun, { type: "sse", event: "run_start", data: { run_id: "r", order: [{ node_id: "direct", type: "llm", label: "Direct" }] } }),
    { type: "sse", event: "node_start", data: { node_id: "direct", type: "llm", label: "Direct" } },
  );
  const withCall = runReducer(started, { type: "sse", event: "tool_call", data: { node_id: "direct", call_id: "c1", name: "exec", args: "{}" } });
  const blocked = runReducer(
    runReducer(withCall, { type: "sse", event: "tool_hook_decision", data: { node_id: "direct", call_id: "c1", hook_id: "guard", decision: "block", reason: "timeout" } }),
    { type: "sse", event: "tool_denied", data: { node_id: "direct", call_id: "c1", reason: "hook", note: "blocked by hook guard" } },
  );
  const call = () => {
    const block = blocked.plan[0].blocks.find((b) => b.kind === "tool");
    if (!block || block.kind !== "tool") throw new Error("no tool block");
    return block.call;
  };

  it("keeps the hook id and the reason on the tool call", () => {
    expect(call().hooks).toEqual([{ hookId: "guard", decision: "block", reason: "timeout" }]);
    expect(call().denied?.reason).toBe("hook");
  });

  it("says a simulated call did not start the hook", () => {
    const withSkip = runReducer(withCall, { type: "sse", event: "tool_hook_decision", data: { node_id: "direct", call_id: "c1", hook_id: "guard", decision: "skipped", reason: "simulated" } });
    const block = withSkip.plan[0].blocks.find((b) => b.kind === "tool");
    if (!block || block.kind !== "tool") throw new Error("no tool block");
    render(<ToolCard call={block.call} runId="r" />);
    expect(screen.getByText(/hook guard: not run \(simulated\)/)).toBeTruthy();
    cleanup();
  });

  it("names the hook on the card", () => {
    render(<ToolCard call={call()} runId="r" />);
    expect(screen.getByText(/hook guard: blocked \(timeout\)/)).toBeTruthy();
    expect(screen.getByText("blocked by hook")).toBeTruthy();
    cleanup();
  });
});

describe("ToolHooksButton", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists, saves and removes hooks, and explains invalid input", async () => {
    const user = userEvent.setup();
    vi.spyOn(toolHooksApi, "list").mockResolvedValue([{ id: "old", argv: ["/x"], timeout_s: 2, tools: ["read"], invalid: false }]);
    const put = vi.spyOn(toolHooksApi, "put").mockResolvedValue();
    const remove = vi.spyOn(toolHooksApi, "remove").mockResolvedValue();
    render(<ToolHooksButton />);
    await user.click(screen.getByRole("button", { name: "Tool hooks" }));
    expect(await screen.findByText("old")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Save hook" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Id:/);
    expect(put).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Hook id"), "guard");
    await user.type(screen.getByLabelText("Program (full path)"), "/usr/bin/audit");
    await user.click(screen.getByRole("button", { name: "Save hook" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("guard", { argv: ["/usr/bin/audit"], timeout_s: 5, tools: ["exec"] }));

    await user.click(screen.getByRole("button", { name: "Remove hook old" }));
    expect(remove).toHaveBeenCalledWith("old");
  });

  it("edits an existing hook in place: fields filled, id fixed, saved under the same id", async () => {
    const user = userEvent.setup();
    vi.spyOn(toolHooksApi, "list").mockResolvedValue([{ id: "old", argv: ["/usr/bin/audit", "--strict", "-v"], timeout_s: 3, tools: ["read", "exec"], invalid: false }]);
    const put = vi.spyOn(toolHooksApi, "put").mockResolvedValue();
    render(<ToolHooksButton />);
    await user.click(screen.getByRole("button", { name: "Tool hooks" }));
    await user.click(await screen.findByRole("button", { name: "Edit hook old" }));
    expect((screen.getByLabelText("Hook id") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Program (full path)") as HTMLInputElement).value).toBe("/usr/bin/audit");
    expect((screen.getByLabelText("Arguments (one per line)") as HTMLTextAreaElement).value).toBe("--strict\n-v");
    await user.clear(screen.getByLabelText("Timeout (seconds)"));
    await user.type(screen.getByLabelText("Timeout (seconds)"), "8");
    await user.click(screen.getByRole("button", { name: "Save hook" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("old", { argv: ["/usr/bin/audit", "--strict", "-v"], timeout_s: 8, tools: ["read", "exec"] }));
    expect(screen.queryByText(/Editing old/)).toBeNull();
  });

  it("removing the hook being edited leaves edit mode, closing the sheet drops a half-finished edit, and an invalid row cannot be edited", async () => {
    const user = userEvent.setup();
    vi.spyOn(toolHooksApi, "list").mockResolvedValue([
      { id: "old", argv: ["/x"], timeout_s: 2, tools: ["read"], invalid: false },
      { id: "broken", argv: [], timeout_s: 1, tools: ["exec", "read", "discover"], invalid: true },
    ]);
    vi.spyOn(toolHooksApi, "remove").mockResolvedValue();
    render(<ToolHooksButton />);
    await user.click(screen.getByRole("button", { name: "Tool hooks" }));
    expect(await screen.findByText(/remove it and register it again/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit hook broken" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit hook old" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Program (full path)")));
    await user.click(screen.getByRole("button", { name: "Remove hook old" }));
    expect(screen.queryByText(/Editing old/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit hook old" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Tool hooks" }));
    expect(screen.queryByText(/Editing/)).toBeNull();
  });

  it("has no axe violations when open", async () => {
    vi.spyOn(toolHooksApi, "list").mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ToolHooksButton />);
    await user.click(screen.getByRole("button", { name: "Tool hooks" }));
    await screen.findByText("No hooks yet.");
    expect(await axeViolations(screen.getByRole("dialog"))).toEqual([]);
  });
});
