import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useThreadStore } from "@/store/threadStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useChatFallbackStore } from "@/store/chatFallbackStore";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { startDirectRun } from "@/components/agent-run/runClient";
import { AgentStage } from "./AgentStage";

vi.mock("@/components/agent-run/runClient", () => ({
  startDirectRun: vi.fn(() => vi.fn()),
  startRun: vi.fn(() => vi.fn()),
  sendControl: vi.fn(async () => undefined),
}));

const account = (id: string, provider: Connection["provider"], label: string): Connection => ({
  id, provider, label, residence: "cloud", endpoint: "", secret: null, health: "live", detail: "", probes: [], facts: [],
  models: [], defaultModel: provider === "openrouter" ? "deepseek/deepseek-v4" : "", enabled: true, lastProbe: "",
});
const initialProviders = useProviderStore.getState();

describe("AgentStage fallback notice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
    useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: null });
    useCanvasStore.setState({ executionMode: "mock", isRunning: false });
    useProviderStore.setState({ connections: [account("an", "anthropic", "Pessoal"), account("or", "openrouter", "Empresa")], hydrated: true, loadState: "ready" });
    useChatProviderStore.setState({ chosenId: "an" });
    useChatFallbackStore.setState({ notice: null });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    useProviderStore.setState(initialProviders, true);
  });

  it("shows who answered after a real failover signal and Back returns the chat to its account", () => {
    render(<AgentStage />);
    const input = screen.getByRole("textbox", { name: "Message OHarness" });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    const call = vi.mocked(startDirectRun).mock.calls.at(-1);
    expect(call?.[0]).toMatchObject({ connection_id: "an" });
    const onEvent = call?.[1] as (event: string, data: Record<string, unknown>) => void;

    act(() => onEvent("node_start", {
      node_id: "direct", connection_id: "or",
      failover: { attempts: [{ connection_id: "an", reason_class: "usage_limit" }] },
    }));
    expect(screen.getByText("Answered by Empresa because Pessoal hit its usage limit")).toBeTruthy();
    expect(useChatProviderStore.getState().chosenId).toBe("or");

    fireEvent.click(screen.getByRole("button", { name: "Back to Pessoal" }));
    expect(useChatProviderStore.getState().chosenId).toBe("an");
    expect(screen.queryByText(/Answered by Empresa/)).toBeNull();
  });
});
