import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";

vi.mock("@/lib/copilot/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot/api")>();
  return { ...actual, planGraphEdit: vi.fn() };
});

import { planGraphEdit, CopilotApiError } from "@/lib/copilot/api";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useCopilotStore } from "@/store/copilotStore";
import { CopilotPanel } from "./CopilotPanel";

const mockPlan = vi.mocked(planGraphEdit);
// The panel answers with the chat's provider (S7), so these tests give it a ready one.
const ready = {
  id: "c1", provider: "anthropic", label: "Claude", residence: "cloud", endpoint: "", secret: null, health: "live",
  detail: "", probes: [], facts: [], models: [], defaultModel: "", route: [], routeSort: "price", allowed: [], enabled: true, lastProbe: "",
} as Connection;
const initialProviders = useProviderStore.getState();
const initialChat = useChatProviderStore.getState();
const ok = (over = {}) => ({ summary: "Done.", ops: [], source: "offline" as const, tokens: 0, ...over });
const renderPanel = () => render(<ReactFlowProvider><CopilotPanel /></ReactFlowProvider>);
const composer = () => screen.getByRole("textbox", { name: /ask nilo|describe/i }) as HTMLTextAreaElement;

beforeEach(() => {
  useProviderStore.setState({ connections: [ready] });
  useChatProviderStore.setState({ chosenId: null });
  mockPlan.mockReset();
  useCanvasStore.setState({ isRunning: false, _history: [], _historyIndex: -1 });
  useCanvasStore.getState().loadGraph([], []);
  useCopilotStore.getState().reset();
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initialProviders);
  useChatProviderStore.setState(initialChat);
});

describe("CopilotPanel", () => {
  it("shows the empty state with three starter prompts", () => {
    renderPanel();
    expect(screen.getByText("Build the graph in plain language")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Build a research → writing → review workflow" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add an agent and help me define how it should behave" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a skill with a clear outcome and a human approval gate" })).toBeTruthy();
  });

  it("a starter prompt sends it", async () => {
    mockPlan.mockResolvedValue(ok());
    renderPanel();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add a skill with a clear outcome and a human approval gate" }));
    await waitFor(() => expect(mockPlan).toHaveBeenCalled());
    expect(mockPlan.mock.calls[0][0].message).toBe("Add a skill with a clear outcome and a human approval gate");
  });

  it("Enter sends and Shift+Enter inserts a newline", async () => {
    mockPlan.mockResolvedValue(ok());
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "line one{Shift>}{Enter}{/Shift}line two");
    expect(composer().value).toBe("line one\nline two");
    expect(mockPlan).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(mockPlan).toHaveBeenCalledTimes(1));
    expect(mockPlan.mock.calls[0][0].message).toBe("line one\nline two");
    await waitFor(() => expect(composer().value).toBe(""));
  });

  it("does not send an empty prompt", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "   {Enter}");
    expect(mockPlan).not.toHaveBeenCalled();
  });

  it("shows Working with a Cancel button while a request is in flight, and Esc cancels", async () => {
    mockPlan.mockImplementation(
      (_r, signal) => new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("a", "AbortError")))),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "build it{Enter}");
    expect(await screen.findByText(/Drafting · /)).toBeTruthy();
    expect(composer().disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.keyDown(composer(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/Drafting/)).toBeNull());
  });

  it("says it is refining, not drafting, while a proposal is still waiting for review", async () => {
    mockPlan.mockResolvedValueOnce(ok({ summary: "Added Writer.", ops: [{ op: "addNode", ref: "n1", type: "agent", label: "Writer" }] }));
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "write{Enter}");
    await screen.findByRole("region", { name: "Proposed changes" });
    mockPlan.mockImplementation(
      (_r, signal) => new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("a", "AbortError")))),
    );
    await user.type(composer(), "make it shorter{Enter}");
    expect(await screen.findByText(/Refining the proposal · /)).toBeTruthy();
  });

  it("tags offline answers", async () => {
    mockPlan.mockResolvedValue(ok({ summary: "Offline draft (rule-based, no model): added Writer.", source: "offline" }));
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "write{Enter}");
    expect(await screen.findByText("Offline draft")).toBeTruthy();
  });

  it("shows a counter after 1800 characters and caps the prompt at 2000", () => {
    renderPanel();
    fireEvent.change(composer(), { target: { value: "x".repeat(1801) } });
    expect(screen.getByText("1801 / 2000")).toBeTruthy();
    fireEvent.change(composer(), { target: { value: "x".repeat(2100) } });
    expect(composer().value).toHaveLength(2000);
  });

  it("is disabled while a run owns the graph", () => {
    useCanvasStore.getState().setRunning(true);
    renderPanel();
    expect(composer().disabled).toBe(true);
  });

  it("an error row offers Try again that resends the same prompt", async () => {
    mockPlan.mockRejectedValueOnce(new CopilotApiError(502, { error: "provider_error", detail: "Upstream said no" }));
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "retry me{Enter}");
    expect(await screen.findByText("Upstream said no")).toBeTruthy();
    mockPlan.mockResolvedValueOnce(ok({ summary: "Second time lucky." }));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Second time lucky.")).toBeTruthy();
    expect(mockPlan.mock.calls[1][0].message).toBe("retry me");
  });

  it("renders model text as plain text, never as HTML", async () => {
    mockPlan.mockResolvedValue(ok({ summary: "<img src=x onerror=alert(1)> **bold** <b>b</b>", source: "model" }));
    const user = userEvent.setup();
    const { container } = renderPanel();
    await user.type(composer(), "xss{Enter}");
    expect(await screen.findByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });
});
