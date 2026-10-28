import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  chatToolsApi: { getPermission: vi.fn(), setPermission: vi.fn(), getTrust: vi.fn(), setTrust: vi.fn(), getPlan: vi.fn(async () => ({ thread_id: "x", plan: null })) },
}));
vi.mock("@/components/agent/chatProvider", () => ({
  pickChatProvider: () => ({ id: "ollama", label: "Ollama", mode: "local", chosen: true }),
}));
vi.mock("@/components/providers/composerAction", () => ({ missingProviderAction: () => null, performInPlace: vi.fn() }));
vi.mock("@/components/agent/useChatTools", () => ({
  useChatTools: () => ({
    workspace: { root: "D:\w", name: "w" }, items: [], error: null, loading: false, readSkill: vi.fn(),
    capabilities: { workspace: { root: "D:\w", name: "w" }, provider_kind: "http", reason: "ok", limits: {},
      tools: { discover: true, read: true, exec: true }, preset: { read: true, exec: true } },
  }),
}));
vi.mock("@/components/agent/HarnessBar", () => ({ HarnessBar: () => <div /> }));
vi.mock("@/components/agent/ChatProviderPicker", () => ({ ChatProviderPicker: () => <div /> }));
vi.mock("@/components/agent/WorkspacePicker", () => ({ WorkspacePicker: () => <div /> }));

const api = vi.mocked(chatToolsApi);
const input = () => screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
const checked = () => screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.textContent;

describe("AgentStage permission mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
    usePermissionStore.setState({ byThread: {}, draft: "ask" });
    useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: null });
    useCanvasStore.setState({ executionMode: "mock", isRunning: false });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    api.setPermission.mockImplementation(async (thread_id, mode) => ({ thread_id, mode }));
    api.getPermission.mockResolvedValue({ thread_id: "x", mode: "ask" });
    api.getTrust.mockResolvedValue({ cwd: "D:\w", trusted: false });
    api.setTrust.mockImplementation(async (cwd, trusted) => ({ cwd, trusted }));
  });
  afterEach(cleanup);

  it("a new conversation starts on ask", () => {
    render(<AgentStage />);
    expect(checked()).toBe("Ask");
  });

  it("the mode chosen before the first message is stored for the new thread before /exec runs, and the run names both", async () => {
    render(<AgentStage />);
    fireEvent.keyDown(input(), { key: "Tab", shiftKey: true });
    expect(checked()).toBe("Auto");
    fireEvent.change(input(), { target: { value: "/exec git status" } });
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(1));
    const threadId = useThreadStore.getState().activeThreadId!;
    expect(api.setPermission).toHaveBeenCalledWith(threadId, "auto_workspace");
    expect(api.setPermission.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(startDirectRun).mock.invocationCallOrder[0]);
    const payload = vi.mocked(startDirectRun).mock.calls[0][0];
    expect(payload.tools).toMatchObject({ thread_id: threadId, permission_mode: "auto_workspace", summarize: false });
    expect(usePermissionStore.getState().modeFor(null)).toBe("ask"); // the next new chat is back on ask
  });

  it("when the sidecar refuses the new thread's mode the run goes out as ask, never as auto", async () => {
    api.setPermission.mockRejectedValue(new Error("boom"));
    render(<AgentStage />);
    fireEvent.keyDown(input(), { key: "Tab", shiftKey: true });
    fireEvent.change(input(), { target: { value: "/exec git status" } });
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(1));
    expect(vi.mocked(startDirectRun).mock.calls[0][0].tools).toMatchObject({ permission_mode: "ask" });
  });

  it("an existing conversation sends its own stored mode with the run", async () => {
    const id = useThreadStore.getState().createThread("t");
    usePermissionStore.getState().setMode(id, "plan");
    api.getPermission.mockResolvedValue({ thread_id: id, mode: "plan" });
    render(<AgentStage />);
    expect(checked()).toBe("Plan");
    fireEvent.change(input(), { target: { value: "/exec git status" } });
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(1));
    expect(vi.mocked(startDirectRun).mock.calls[0][0].tools).toMatchObject({ thread_id: id, permission_mode: "plan" });
  });

  it("each conversation shows its own mode when you switch", () => {
    const a = useThreadStore.getState().createThread("a");
    const b = useThreadStore.getState().createThread("b");
    usePermissionStore.getState().setMode(a, "plan");
    useThreadStore.getState().selectThread(a);
    render(<AgentStage />);
    expect(checked()).toBe("Plan");
    cleanup();
    useThreadStore.getState().selectThread(b);
    render(<AgentStage />);
    expect(checked()).toBe("Ask");
  });

  it("trust controls appear only under Auto, and trusting the workspace goes through the sidecar after a warning", async () => {
    render(<AgentStage />);
    expect(screen.queryByRole("button", { name: "Trust this workspace…" })).toBeNull();
    expect(api.getTrust).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Tab", shiftKey: true });
    await waitFor(() => expect(api.getTrust).toHaveBeenCalledWith("D:\w"));
    fireEvent.click(await screen.findByRole("button", { name: "Trust this workspace…" }));
    expect(api.setTrust).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Trust" }));
    await waitFor(() => expect(api.setTrust).toHaveBeenCalledWith("D:\w", true));
    expect(await screen.findByRole("button", { name: "Revoke trust" })).toBeTruthy();
  });
});
