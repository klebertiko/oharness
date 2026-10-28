import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useThreadStore } from "@/store/threadStore";
import { usePermissionStore } from "@/store/permissionStore";
import { useMessageQueueStore } from "@/store/messageQueueStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useCanvasStore } from "@/store/canvasStore";
import { startDirectRun } from "@/components/agent-run/runClient";
import { AgentStage } from "./AgentStage";

vi.mock("@/components/agent-run/runClient", () => ({
  startDirectRun: vi.fn(() => vi.fn()),
  startRun: vi.fn(() => vi.fn()),
  sendControl: vi.fn(async () => undefined),
}));
vi.mock("@/lib/chatToolsApi", () => ({
  chatToolsApi: { getPermission: vi.fn(async () => ({ thread_id: "x", mode: "ask" })), setPermission: vi.fn(), getTrust: vi.fn(), setTrust: vi.fn(), getPlan: vi.fn(async () => ({ thread_id: "x", plan: null })) },
}));
vi.mock("@/components/agent/chatProvider", () => ({
  pickChatProvider: () => ({ id: "ollama", label: "Ollama", mode: "local", chosen: true }),
  missingProviderAction: () => null,
}));
vi.mock("@/components/agent/useChatTools", () => ({
  useChatTools: () => ({ workspace: null, items: [], error: null, loading: false, readSkill: vi.fn(), capabilities: null }),
}));
vi.mock("@/components/agent/HarnessBar", () => ({ HarnessBar: () => <div /> }));
vi.mock("@/components/agent/ChatProviderPicker", () => ({ ChatProviderPicker: () => <div /> }));
vi.mock("@/components/agent/WorkspacePicker", () => ({ WorkspacePicker: () => <div /> }));

const input = () => screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
type OnEvent = (event: string, data: Record<string, unknown>) => void;
const emit = (event: string, data: Record<string, unknown> = {}) => act(() => { (vi.mocked(startDirectRun).mock.calls.at(-1)![1] as OnEvent)(event, data); });
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const send = () => fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
const begin = (id: string) => emit("run_start", { run_id: id, mode: "live", step: false, order: [{ node_id: "direct", type: "agent", label: "Chat", adapter: "http", model: "" }], unreachable: [] });
const finish = (output: string) => { emit("node_done", { node_id: "direct", output, tokens: 2 }); emit("harness_done", { status: "complete", total_tokens: 2, elapsed_ms: 5, nodes_run: 1 }); };
const instructions = () => vi.mocked(startDirectRun).mock.calls.map((c) => c[0].instruction);

describe("AgentStage message queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
    usePermissionStore.setState({ byThread: {}, draft: "ask" });
    useMessageQueueStore.setState({ byThread: {} });
    useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: null });
    useCanvasStore.setState({ executionMode: "mock", isRunning: false });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);

  async function firstTurnRunning() {
    render(<AgentStage />);
    type("first");
    send();
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(1));
    begin("r1");
  }

  it("a message sent while a run is active goes into a visible queue and does not start", async () => {
    await firstTurnRunning();
    type("second");
    send();
    const region = await screen.findByRole("region", { name: "Queued messages" });
    expect(within(region).getByText("second")).toBeTruthy();
    expect(startDirectRun).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("");
    const thread = useThreadStore.getState().activeThreadId!;
    expect(useThreadStore.getState().messagesByThread[thread].map((m) => m.content)).toEqual(["first"]);
  });

  it("the queue button does the same as the shortcut", async () => {
    await firstTurnRunning();
    type("second");
    fireEvent.click(screen.getByRole("button", { name: "Queue message" }));
    expect(await screen.findByRole("region", { name: "Queued messages" })).toBeTruthy();
    expect(startDirectRun).toHaveBeenCalledTimes(1);
  });

  it("runs only after the current turn has finished, and after its answer is in the chat", async () => {
    await firstTurnRunning();
    type("second");
    send();
    await screen.findByRole("region", { name: "Queued messages" });
    expect(instructions()).toEqual(["first"]);
    finish("answer one");
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(2));
    expect(instructions()).toEqual(["first", "second"]);
    const thread = useThreadStore.getState().activeThreadId!;
    expect(useThreadStore.getState().messagesByThread[thread].map((m) => m.content)).toEqual(["first", "answer one", "second"]);
    expect(screen.queryByRole("region", { name: "Queued messages" })).toBeNull();
  });

  it("messages run one at a time, in the order they were queued", async () => {
    await firstTurnRunning();
    type("second"); send();
    type("third"); send();
    finish("a1");
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(2));
    expect(instructions()).toEqual(["first", "second"]);
    begin("r2");
    expect(screen.getByRole("region", { name: "Queued messages" }).textContent).toContain("third");
    finish("a2");
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(3));
    expect(instructions()).toEqual(["first", "second", "third"]);
  });

  it("a draft typed while the queue drains is kept", async () => {
    await firstTurnRunning();
    type("second"); send();
    type("half-written thought");
    finish("a1");
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(2));
    expect(input().value).toBe("half-written thought");
  });

  it("a queued message can be removed before it runs", async () => {
    await firstTurnRunning();
    type("second"); send();
    fireEvent.click(await screen.findByRole("button", { name: "Remove queued message: second" }));
    expect(screen.queryByRole("region", { name: "Queued messages" })).toBeNull();
    finish("a1");
    expect(startDirectRun).toHaveBeenCalledTimes(1);
  });

  it("when the turn stops or fails the queue pauses instead of running on its own", async () => {
    await firstTurnRunning();
    type("second"); send();
    emit("error", { message: "boom" });
    const region = await screen.findByRole("region", { name: "Queued messages" });
    expect(region.textContent).toMatch(/paused/i);
    expect(startDirectRun).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Send next" }));
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(2));
    expect(instructions()).toEqual(["first", "second"]);
  });

  it("Clear queue empties it", async () => {
    await firstTurnRunning();
    type("second"); send();
    type("third"); send();
    emit("error", { message: "boom" });
    fireEvent.click(await screen.findByRole("button", { name: "Clear queue" }));
    expect(screen.queryByRole("region", { name: "Queued messages" })).toBeNull();
  });

  it("when nothing is running a message just starts", async () => {
    render(<AgentStage />);
    type("only");
    send();
    await waitFor(() => expect(startDirectRun).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("region", { name: "Queued messages" })).toBeNull();
  });
});
