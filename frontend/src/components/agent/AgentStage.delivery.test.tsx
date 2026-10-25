import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useThreadStore } from "@/store/threadStore";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { sendControl, startDirectRun } from "@/components/agent-run/runClient";
import { AgentStage } from "./AgentStage";

vi.mock("@/components/agent-run/runClient", () => ({ startDirectRun: vi.fn(() => vi.fn()), startRun: vi.fn(() => vi.fn()), sendControl: vi.fn(async () => undefined) }));
vi.mock("./useChatTools", () => ({ useChatTools: () => ({ workspace: null, capabilities: null, items: [], loading: false, error: null }) }));
vi.mock("./HarnessBar", () => ({ HarnessBar: () => <div /> }));
vi.mock("./WorkspacePicker", () => ({ WorkspacePicker: () => <div /> }));
vi.mock("./usePermissionMode", () => ({ usePermissionMode: () => ({ mode: "ask", adopt: vi.fn(async () => "ask"), setMode: vi.fn() }) }));
vi.mock("@/lib/usageApi", () => ({ usageApi: { summary: vi.fn(async () => ({})) } }));

const connection: Connection = { id: "local", provider: "ollama", label: "Local test", residence: "local", endpoint: "http://localhost:11434", secret: null, health: "live", detail: "", probes: [], facts: [], models: [{ id: "test-model", ctx: 8192 }], defaultModel: "test-model", enabled: true, lastProbe: "" };
const input = () => screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
function send(text = "Explain this") {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
}
function event(name: string, data: Record<string, unknown>) {
  act(() => vi.mocked(startDirectRun).mock.calls.at(-1)![1](name, data));
}
beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: null });
  useProviderStore.setState({ connections: [connection] });
  useChatProviderStore.setState({ chosenId: "local" });
});
afterEach(cleanup);

it("preserves independent drafts when switching chats", () => {
  const a = useThreadStore.getState().createThread("A");
  const b = useThreadStore.getState().createThread("B");
  act(() => useThreadStore.getState().selectThread(a));
  render(<AgentStage />);
  fireEvent.change(input(), { target: { value: "draft A" } });
  act(() => useThreadStore.getState().selectThread(b));
  expect(input().value).toBe("");
  fireEvent.change(input(), { target: { value: "draft B" } });
  act(() => useThreadStore.getState().selectThread(a));
  expect(input().value).toBe("draft A");
});

it("shows streamed text and saves completion only in the originating chat", () => {
  const a = useThreadStore.getState().createThread("A");
  render(<AgentStage />);
  send();
  event("run_start", { run_id: "run-a", order: [{ node_id: "reply", type: "agent", label: "Nilo" }] });
  event("node_start", { node_id: "reply", adapter: "ollama", model: "test-model" });
  event("node_stream", { node_id: "reply", chunk: "Visible while streaming" });
  expect(screen.getByLabelText("Live answer").textContent).toContain("Visible while streaming");
  let b = "";
  act(() => { b = useThreadStore.getState().createThread("B"); });
  expect(screen.queryByLabelText("Live answer")).toBeNull();
  expect(screen.getByRole("button", { name: "Return to running chat" })).toBeTruthy();
  event("node_done", { node_id: "reply", output: "Answer for A", tokens: 4 });
  event("harness_done", { tokens: 4 });
  expect(useThreadStore.getState().messagesByThread[a].at(-1)?.content).toBe("Answer for A");
  expect(useThreadStore.getState().messagesByThread[b]).toEqual([]);
});

it("recovers an instruction after a transport failure before a run id exists", () => {
  render(<AgentStage />);
  send("Recover my prompt");
  act(() => vi.mocked(startDirectRun).mock.calls[0][2](new Error("sidecar offline")));
  expect(screen.getByRole("alert").textContent).toContain("sidecar offline");
  fireEvent.click(screen.getByRole("button", { name: "Reuse instruction" }));
  expect(input().value).toBe("Recover my prompt");
  expect(startDirectRun).toHaveBeenCalledTimes(1);
});

it("offers a model per direct turn without changing the connection default", () => {
  render(<AgentStage />);
  fireEvent.click(screen.getByRole("button", { name: "Model for next turn: Connection default" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "custom-test-model" } });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  send();
  expect(vi.mocked(startDirectRun).mock.calls[0][0]).toMatchObject({ connection_id: "local", model: "custom-test-model" });
  expect(useProviderStore.getState().connections[0].defaultModel).toBe("test-model");
});

it("dispatches slash tool instructions through the same preset contract from the send button", () => {
  useThreadStore.getState().createThread("Tool chat");
  render(<AgentStage />);
  send("/read README.md");
  expect(vi.mocked(startDirectRun).mock.calls[0][0]).toMatchObject({ instruction: "", tools: { preset: { name: "read", path: "README.md" } } });
});

it("does not send shell syntax from the send button when the composer warns", () => {
  render(<AgentStage />);
  send("/exec npm test && whoami");
  expect(startDirectRun).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(true);
});

it("stops a turn and reuses its instruction without automatically sending again", () => {
  render(<AgentStage />);
  send("Stop and recover this");
  event("run_start", { run_id: "stopped-turn", order: [{ node_id: "reply", type: "agent", label: "Reply" }] });
  fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
  expect(sendControl).toHaveBeenCalledWith("stopped-turn", { action: "stop" });
  event("run_stopped", {});
  event("harness_done", { status: "stopped", total_tokens: 0 });
  expect(screen.getByText("The turn stopped. You can reuse your instruction when ready.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reuse instruction" }));
  expect(input().value).toBe("Stop and recover this");
  expect(startDirectRun).toHaveBeenCalledTimes(1);
});
