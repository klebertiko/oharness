import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useThreadStore } from "@/store/threadStore";
import { usePermissionStore } from "@/store/permissionStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useCanvasStore } from "@/store/canvasStore";
import { startDirectRun, startRun } from "@/components/agent-run/runClient";
import { chatToolsApi } from "@/lib/chatToolsApi";
import { AgentStage } from "./AgentStage";

vi.mock("@/components/agent-run/runClient", () => ({
  startDirectRun: vi.fn(() => vi.fn()),
  startRun: vi.fn(() => vi.fn()),
  sendControl: vi.fn(async () => undefined),
}));
vi.mock("@/lib/chatToolsApi", () => ({
  chatToolsApi: { getPermission: vi.fn(), setPermission: vi.fn(), getTrust: vi.fn(), setTrust: vi.fn(), getPlan: vi.fn(), approvePlan: vi.fn(), discardPlan: vi.fn() },
}));
vi.mock("@/components/agent/chatProvider", () => ({
  pickChatProvider: () => ({ id: "ollama", label: "Ollama", mode: "local", chosen: true }),
  missingProviderAction: () => null,
}));
vi.mock("@/components/agent/useChatTools", () => ({
  useChatTools: () => ({ workspace: { root: "D:\w", name: "w" }, items: [], error: null, loading: false, readSkill: vi.fn(), capabilities: null }),
}));
vi.mock("@/components/agent/HarnessBar", () => ({ HarnessBar: () => <div /> }));
vi.mock("@/components/agent/ChatProviderPicker", () => ({ ChatProviderPicker: () => <div /> }));
vi.mock("@/components/agent/WorkspacePicker", () => ({ WorkspacePicker: () => <div /> }));

const api = vi.mocked(chatToolsApi);
const input = () => screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
const checked = () => screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.textContent;
type OnEvent = (event: string, data: Record<string, unknown>) => void;
const emit = (event: string, data: Record<string, unknown> = {}) => act(() => { (vi.mocked(startDirectRun).mock.calls.at(-1)![1] as OnEvent)(event, data); });

async function sendInPlanMode(text = "Add a settings page") {
  fireEvent.click(screen.getByRole("radio", { name: /Plan/ }));
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(1));
  return useThreadStore.getState().activeThreadId!;
}
const planEvents = (threadId: string) => {
  emit("run_start", { run_id: "r1", mode: "live", step: false, order: [{ node_id: "direct", type: "agent", label: "Chat", adapter: "http", model: "" }], unreachable: [] });
  emit("node_done", { node_id: "direct", output: "1. Add the page", tokens: 3 });
  emit("plan_proposed", { node_id: "direct", plan_id: "p1", thread_id: threadId, text: "1. Add the page", status: "proposed" });
  emit("harness_done", { status: "complete", total_tokens: 3, elapsed_ms: 5, nodes_run: 1 });
};

describe("AgentStage plan mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
    usePermissionStore.setState({ byThread: {}, draft: "ask" });
    useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: null });
    useCanvasStore.setState({ executionMode: "mock", isRunning: false });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    api.setPermission.mockImplementation(async (thread_id, mode) => ({ thread_id, mode }));
    api.getPermission.mockResolvedValue({ thread_id: "x", mode: "plan" });
    api.getPlan.mockResolvedValue({ thread_id: "x", plan: null });
    api.approvePlan.mockImplementation(async (thread_id, plan_id, mode = "ask") => ({ thread_id, plan_id, status: "approved", mode }));
    api.discardPlan.mockImplementation(async (thread_id, plan_id) => ({ thread_id, plan_id, status: "discarded" }));
  });
  afterEach(cleanup);

  it("a plain message in Plan mode goes out as a direct run that names the thread and the mode", async () => {
    render(<AgentStage />);
    const threadId = await sendInPlanMode();
    expect(vi.mocked(startDirectRun).mock.calls[0][0].tools).toMatchObject({ thread_id: threadId, permission_mode: "plan", enabled: false });
  });

  it("with a harness enabled, Plan mode still answers directly: the harness graph does not run before approval", async () => {
    useHarnessSessionStore.setState({ hydrated: true, enabled: true, activeBundle: { manifest: { name: "H" }, graph: { nodes: [{ id: "a", type: "agent", data: {} }], edges: [] } } as never });
    render(<AgentStage />);
    await sendInPlanMode();
    expect(startRun).not.toHaveBeenCalled();
  });

  it("a plan the run ends in appears as a card; nothing runs until it is approved", async () => {
    render(<AgentStage />);
    const threadId = await sendInPlanMode();
    planEvents(threadId);
    expect(await screen.findByRole("region", { name: "Plan awaiting your approval" })).toBeTruthy();
    expect(startDirectRun).toHaveBeenCalledTimes(1);
    expect(api.approvePlan).not.toHaveBeenCalled();
  });

  it("approving moves the chat to Ask and sends the approved plan as the next turn", async () => {
    render(<AgentStage />);
    const threadId = await sendInPlanMode();
    planEvents(threadId);
    fireEvent.click(await screen.findByRole("button", { name: "Approve plan" }));
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(2));
    expect(api.approvePlan).toHaveBeenCalledWith(threadId, "p1");
    expect(checked()).toBe("Ask");
    const second = vi.mocked(startDirectRun).mock.calls[1][0];
    expect(second.instruction).toContain("1. Add the page");
    expect(second.tools).toMatchObject({ thread_id: threadId, permission_mode: "ask" });
    expect(screen.queryByRole("region", { name: "Plan awaiting your approval" })).toBeNull();
  });

  it("discarding keeps Plan mode and runs nothing", async () => {
    render(<AgentStage />);
    const threadId = await sendInPlanMode();
    planEvents(threadId);
    fireEvent.click(await screen.findByRole("button", { name: "Discard plan" }));
    await waitFor(() => expect(api.discardPlan).toHaveBeenCalledWith(threadId, "p1"));
    expect(checked()).toBe("Plan");
    expect(startDirectRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Plan awaiting your approval" })).toBeNull();
  });

  it("when the sidecar refuses the approval the plan stays, Plan mode stays, and nothing runs", async () => {
    api.approvePlan.mockRejectedValue(new Error("boom"));
    render(<AgentStage />);
    const threadId = await sendInPlanMode();
    planEvents(threadId);
    fireEvent.click(await screen.findByRole("button", { name: "Approve plan" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/approve/i);
    expect(checked()).toBe("Plan");
    expect(startDirectRun).toHaveBeenCalledTimes(1);
  });

  it("a plan still waiting on the sidecar comes back after a reload", async () => {
    const id = useThreadStore.getState().createThread("t");
    useThreadStore.getState().appendMessage(id, { role: "assistant", content: "1. Restored" });
    usePermissionStore.getState().setMode(id, "plan");
    api.getPlan.mockResolvedValue({ thread_id: id, plan: { plan_id: "p9", thread_id: id, text: "1. Restored", status: "proposed" } });
    render(<AgentStage />);
    const region = await screen.findByRole("region", { name: "Plan awaiting your approval" });
    expect(region.textContent).toContain("1. Restored");
  });
});
