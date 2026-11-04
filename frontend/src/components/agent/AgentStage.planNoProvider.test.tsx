import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useThreadStore } from "@/store/threadStore";
import { usePermissionStore } from "@/store/permissionStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useCanvasStore } from "@/store/canvasStore";
import { startDirectRun } from "@/components/agent-run/runClient";
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
  pickChatProvider: () => null,
}));
vi.mock("@/components/providers/composerAction", () => ({ missingProviderAction: () => null, performInPlace: vi.fn() }));
vi.mock("@/components/agent/useChatTools", () => ({
  useChatTools: () => ({ workspace: { root: "D:\w", name: "w" }, items: [], error: null, loading: false, readSkill: vi.fn(), capabilities: null }),
}));
vi.mock("@/components/agent/HarnessBar", () => ({ HarnessBar: () => <div /> }));
vi.mock("@/components/agent/ChatProviderPicker", () => ({ ChatProviderPicker: () => <div /> }));

const api = vi.mocked(chatToolsApi);

describe("approving a plan with no provider connected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
    usePermissionStore.setState({ byThread: {}, draft: "ask" });
    useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: null });
    useCanvasStore.setState({ executionMode: "mock", isRunning: false });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    api.getPermission.mockResolvedValue({ thread_id: "x", mode: "plan" });
    api.getPlan.mockResolvedValue({ thread_id: "x", plan: { plan_id: "p1", text: "1. Add the page", status: "proposed" } as never });
  });
  afterEach(cleanup);

  it("says why nothing happened and leaves the plan waiting, unconsumed", async () => {
    const threadId = useThreadStore.getState().createThread("Planned");
    useThreadStore.getState().appendMessage(threadId, { role: "user", content: "Add a settings page" });
    usePermissionStore.getState().setMode(threadId, "plan");
    render(<AgentStage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve plan" }));
    expect(await screen.findByText(/connect a provider/i)).toBeTruthy();
    expect(api.approvePlan).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Plan awaiting your approval" })).toBeTruthy();
    expect(startDirectRun).not.toHaveBeenCalled();
  });
});
