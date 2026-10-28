import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NO_HARNESS } from "@/lib/chatHarness";
import { useThreadStore } from "@/store/threadStore";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { startDirectRun, startRun } from "@/components/agent-run/runClient";
import { AgentStage } from "./AgentStage";

vi.mock("@/components/agent-run/runClient", () => ({ startDirectRun: vi.fn(() => vi.fn()), startRun: vi.fn(() => vi.fn()), sendControl: vi.fn(async () => undefined) }));
vi.mock("./useChatTools", () => ({ useChatTools: () => ({ workspace: null, capabilities: null, items: [], loading: false, error: null }) }));
vi.mock("./HarnessBar", () => ({ HarnessBar: () => <div /> }));
vi.mock("./WorkspacePicker", () => ({ WorkspacePicker: () => <div /> }));
vi.mock("./usePermissionMode", () => ({ usePermissionMode: () => ({ mode: "ask", adopt: vi.fn(async () => "ask"), setMode: vi.fn() }) }));
vi.mock("@/lib/usageApi", () => ({ usageApi: { summary: vi.fn(async () => ({})) } }));

const connection: Connection = { id: "local", provider: "ollama", label: "Local test", residence: "local", endpoint: "http://localhost:11434", secret: null, health: "live", detail: "", probes: [], facts: [], models: [{ id: "test-model", ctx: 8192 }], defaultModel: "test-model", enabled: true, lastProbe: "" };
const agile = { manifest: { id: "agile", name: "Agile Harness" }, graph: { nodes: [{ id: "a", type: "agent", position: { x: 0, y: 0 }, data: { label: "A" } }], edges: [] } };
const input = () => screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
const sendButton = () => screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement;
function send(text = "Explain this") {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.click(sendButton());
}

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  useHarnessLibraryStore.setState({ entries: [{ id: "agile", name: "Agile Harness", isDefault: true, bundle: agile as never, addedAt: 0 }], hydrated: true, failed: false } as never);
  useHarnessSessionStore.setState({ hydrated: true, enabled: true, activeBundle: agile as never });
  useProviderStore.setState({ connections: [connection] });
  useChatProviderStore.setState({ chosenId: "local" });
});
afterEach(cleanup);

it("a chat is born with the harness that was selected when its first message was sent", () => {
  render(<AgentStage />);
  send();
  expect(useThreadStore.getState().threads[0].harness).toEqual({ kind: "harness", id: "agile", name: "Agile Harness" });
  expect(startRun).toHaveBeenCalled();
});

it("stamps the reply with the harness that ran it, even if the chat's harness changes while it runs", () => {
  const id = useThreadStore.getState().createThread("Plan", { kind: "harness", id: "agile", name: "Agile Harness" });
  render(<AgentStage />);
  send();
  act(() => useThreadStore.getState().setThreadHarness(id, NO_HARNESS));
  const emit = vi.mocked(startRun).mock.calls.at(-1)![1] as (name: string, data: Record<string, unknown>) => void;
  act(() => emit("run_start", { run_id: "r1", order: [{ node_id: "a", type: "agent", label: "A" }] }));
  act(() => emit("node_start", { node_id: "a", adapter: "ollama", model: "test-model" }));
  act(() => emit("node_done", { node_id: "a", output: "Answer", tokens: 1 }));
  act(() => emit("harness_done", { tokens: 1 }));
  const reply = useThreadStore.getState().messagesFor(id).find((m) => m.role === "assistant");
  expect(reply?.harness).toEqual({ kind: "harness", id: "agile", name: "Agile Harness" });
});

it("a harness that is gone blocks sending, says so, and offers to continue without one", () => {
  useThreadStore.getState().createThread("Old", { kind: "harness", id: "gone", name: "Retired Harness" });
  render(<AgentStage />);
  fireEvent.change(input(), { target: { value: "Hello" } });
  expect(sendButton().disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toMatch(/Retired Harness isn.t available/);
  fireEvent.click(screen.getByRole("button", { name: "Continue without a harness" }));
  expect(useThreadStore.getState().threads[0].harness).toEqual(NO_HARNESS);
  expect(sendButton().disabled).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows the harness change as a quiet line in the transcript", () => {
  const id = useThreadStore.getState().createThread("Plan", NO_HARNESS);
  useThreadStore.getState().appendMessage(id, { role: "user", content: "hi" });
  useThreadStore.getState().appendMessage(id, { role: "assistant", content: "hello", harness: NO_HARNESS });
  useThreadStore.getState().setThreadHarness(id, { kind: "harness", id: "agile", name: "Agile Harness" });
  render(<AgentStage />);
  const note = screen.getByRole("separator", { name: /Harness changed to Agile Harness/ });
  expect(note).toBeTruthy();
  expect(vi.mocked(startDirectRun)).not.toHaveBeenCalled();
});

it("a chat from before the setting existed is bound to what it runs with on the next send", () => {
  const id = useThreadStore.getState().createThread("Legacy");
  expect(useThreadStore.getState().threads[0].harness).toBeUndefined();
  render(<AgentStage />);
  send();
  expect(useThreadStore.getState().threads.find((t) => t.id === id)?.harness).toEqual({ kind: "harness", id: "agile", name: "Agile Harness" });
  expect(useThreadStore.getState().messagesFor(id).some((m) => m.role === "system")).toBe(false);
});
