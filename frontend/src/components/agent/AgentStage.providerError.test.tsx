import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useThreadStore } from "@/store/threadStore";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useComposerDraftStore } from "@/store/composerDraftStore";
import { useLocaleStore } from "@/i18n/store";
import { startDirectRun } from "@/components/agent-run/runClient";
import { AgentStage } from "./AgentStage";

vi.mock("@/components/agent-run/runClient", () => ({ startDirectRun: vi.fn(() => vi.fn()), startRun: vi.fn(() => vi.fn()), sendControl: vi.fn(async () => undefined) }));
vi.mock("./useChatTools", () => ({ useChatTools: () => ({ workspace: null, capabilities: null, items: [], loading: false, error: null }) }));
vi.mock("./HarnessBar", () => ({ HarnessBar: () => <div /> }));
vi.mock("./WorkspacePicker", () => ({ WorkspacePicker: () => <div /> }));
vi.mock("./usePermissionMode", () => ({ usePermissionMode: () => ({ mode: "ask", adopt: vi.fn(async () => "ask"), setMode: vi.fn() }) }));
vi.mock("@/lib/usageApi", () => ({ usageApi: { summary: vi.fn(async () => ({})) } }));

const CANARY = "CANARY-backend-7f3c";
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
  useLocaleStore.setState({ locale: "en" });
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: null });
  useProviderStore.setState({ connections: [connection], usageLimit: null });
  useChatProviderStore.setState({ chosenId: "local" });
  useComposerDraftStore.setState({ held: null });
});
afterEach(cleanup);

it("a failed turn says what happened, why, and what to do, from the catalog and not from the sidecar's text", () => {
  render(<AgentStage />);
  send();
  event("run_start", { run_id: "r1", order: [{ node_id: "direct", type: "agent", label: "Nilo" }] });
  event("node_start", { node_id: "direct", adapter: "ollama", model: "test-model" });
  event("node_error", { node_id: "direct", connection_id: "local", provider_failure: "overload", error: CANARY });
  event("harness_done", { status: "error", total_tokens: 0 });
  const alert = screen.getAllByRole("alert").find((el) => el.textContent?.includes("The service is overloaded"));
  expect(alert, "catalog what").toBeTruthy();
  expect(alert!.textContent).toContain("It could not answer right now");
  expect(alert!.textContent).toContain("Try again in a few minutes");
  expect(document.body.textContent).not.toContain(CANARY);
});

it("a run-level usage limit with no connection id raises the limit banner for the chat's connection", () => {
  render(<AgentStage />);
  send();
  event("run_start", { run_id: "r2", order: [{ node_id: "direct", type: "agent", label: "Nilo" }] });
  event("error", { provider_failure: "usage_limit", error: CANARY });
  expect(useProviderStore.getState().usageLimit?.connectionId).toBe("local");
  expect(screen.getByRole("button", { name: "Use an API key" })).toBeTruthy();
  expect(document.body.textContent).toContain("The subscription limit has been reached");
  expect(document.body.textContent).not.toContain(CANARY);
});

it("the held draft goes back to the composer on cancel, and when the limit goes away", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-21T09:00:00Z"));
  try {
    render(<AgentStage />);
    send();
    event("run_start", { run_id: "r3", order: [{ node_id: "direct", type: "agent", label: "Nilo" }] });
    event("error", { provider_failure: "usage_limit", reset_at: "2026-11-21T09:20:00Z" });
    fireEvent.change(input(), { target: { value: "send me later" } });
    fireEvent.click(screen.getByRole("button", { name: "Wait and send when it frees up" }));
    expect(input().value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel and give the text back" }));
    expect(input().value).toBe("send me later");
    expect(useComposerDraftStore.getState().held).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Wait and send when it frees up" }));
    expect(input().value).toBe("");
    act(() => useProviderStore.getState().clearUsageLimit());
    expect(input().value).toBe("send me later");
    expect(useComposerDraftStore.getState().held).toBeNull();
    expect(startDirectRun).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
