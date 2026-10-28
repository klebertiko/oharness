import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";

vi.mock("@/lib/copilot/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot/api")>();
  return { ...actual, planGraphEdit: vi.fn() };
});

import { planGraphEdit } from "@/lib/copilot/api";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";
import { useCopilotStore } from "@/store/copilotStore";
import { CopilotPanel } from "./CopilotPanel";

const mockPlan = vi.mocked(planGraphEdit);
const ok = (over = {}) => ({ summary: "Done.", ops: [], source: "model" as const, tokens: 5, ...over });
const conn = (over: Partial<Connection>): Connection =>
  ({
    id: "c1", provider: "anthropic", label: "Claude", residence: "cloud", endpoint: "", secret: null, health: "live",
    detail: "", probes: [], facts: [], models: [], defaultModel: "", route: [], routeSort: "price", allowed: [], enabled: true, lastProbe: "", ...over,
  }) as Connection;

const initial = { providers: useProviderStore.getState(), chat: useChatProviderStore.getState(), setup: useChatSetupRequestStore.getState() };
const renderPanel = () => render(<ReactFlowProvider><CopilotPanel /></ReactFlowProvider>);
const composer = () => screen.getByRole("textbox", { name: "Ask Nilo" }) as HTMLTextAreaElement;

beforeEach(() => {
  mockPlan.mockReset();
  useCanvasStore.setState({ isRunning: false, _history: [], _historyIndex: -1 });
  useCanvasStore.getState().loadGraph([], []);
  useCopilotStore.getState().reset();
  useChatProviderStore.setState({ chosenId: null });
  useChatSetupRequestStore.setState({ token: 0, id: null });
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initial.providers);
  useChatProviderStore.setState(initial.chat);
  useChatSetupRequestStore.setState(initial.setup);
});

describe("CopilotPanel with a ready provider", () => {
  beforeEach(() => useProviderStore.setState({ connections: [conn({ id: "claude-1", label: "Claude" })] }));

  it("shows the provider line with its label and status word", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /Answers with Claude · Verified/ })).toBeTruthy();
  });

  it("sends live with the chosen connection id", async () => {
    mockPlan.mockResolvedValue(ok());
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "add a reviewer{Enter}");
    await waitFor(() => expect(mockPlan).toHaveBeenCalledTimes(1));
    expect(mockPlan.mock.calls[0][0]).toMatchObject({ message: "add a reviewer", mode: "live", connection_id: "claude-1" });
  });

  it("uses local mode for an on-device connection", async () => {
    useProviderStore.setState({ connections: [conn({ id: "ol", provider: "ollama", residence: "local", label: "Ollama", endpoint: "http://127.0.0.1:11434/v1", defaultModel: "llama3" })] });
    mockPlan.mockResolvedValue(ok());
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "hi{Enter}");
    await waitFor(() => expect(mockPlan).toHaveBeenCalled());
    expect(mockPlan.mock.calls[0][0]).toMatchObject({ mode: "local", connection_id: "ol" });
  });

  it("a starter prompt goes to the live provider", async () => {
    mockPlan.mockResolvedValue(ok());
    renderPanel();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add a skill with a clear outcome and a human approval gate" }));
    await waitFor(() => expect(mockPlan).toHaveBeenCalled());
    expect(mockPlan.mock.calls[0][0]).toMatchObject({ mode: "live", connection_id: "claude-1" });
  });

  it("Try again resends through the current provider", async () => {
    mockPlan.mockRejectedValueOnce(new Error("down"));
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "retry me{Enter}");
    await screen.findByRole("button", { name: "Try again" });
    mockPlan.mockResolvedValueOnce(ok({ summary: "Back." }));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Back.");
    expect(mockPlan.mock.calls[1][0]).toMatchObject({ message: "retry me", mode: "live", connection_id: "claude-1" });
  });

  it("does not offer the offline draft while a provider is ready", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "Use offline draft" })).toBeNull();
  });
});

describe("CopilotPanel with no provider", () => {
  // OpenRouter takes an API key, so its missing-provider action is "Paste a … key".
  beforeEach(() => useProviderStore.setState({ connections: [conn({ id: "off", provider: "openrouter", label: "OpenRouter", enabled: false, health: "setup" })] }));

  it("replaces Send with the missing-provider action and sends nothing on Enter", async () => {
    useChatProviderStore.setState({ chosenId: "off" });
    const user = userEvent.setup();
    renderPanel();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await user.type(composer(), "add a reviewer{Enter}");
    expect(mockPlan).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Paste an OpenRouter key/ })).toBeTruthy();
  });

  it("the missing-provider action requests the inline setup for that connection", async () => {
    useChatProviderStore.setState({ chosenId: "off" });
    renderPanel();
    await userEvent.setup().click(screen.getByRole("button", { name: /Paste an OpenRouter key/ }));
    expect(useChatSetupRequestStore.getState()).toMatchObject({ id: "off", token: expect.any(Number) });
    expect(useChatSetupRequestStore.getState().token).toBeGreaterThan(0);
  });

  it("with nothing to expand it opens Providers", async () => {
    useProviderStore.setState({ connections: [] });
    useShellStore.setState({ section: "studio" });
    renderPanel();
    await userEvent.setup().click(screen.getByRole("button", { name: "Connect a provider to send" }));
    expect(useShellStore.getState().section).toBe("providers");
  });

  it("Use offline draft sends the typed prompt in mock mode and tags the answer", async () => {
    mockPlan.mockResolvedValue(ok({ summary: "Offline draft (rule-based, no model): added Writer.", source: "offline" }));
    const user = userEvent.setup();
    renderPanel();
    expect((screen.getByRole("button", { name: "Use offline draft" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(composer(), "write something");
    await user.click(screen.getByRole("button", { name: "Use offline draft" }));
    await waitFor(() => expect(mockPlan).toHaveBeenCalledTimes(1));
    expect(mockPlan.mock.calls[0][0]).toMatchObject({ message: "write something", mode: "mock", connection_id: null });
    expect(await screen.findByText("Offline draft")).toBeTruthy();
  });

  it("a starter prompt fills the composer instead of sending", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Add an agent and help me define how it should behave" }));
    expect(composer().value).toBe("Add an agent and help me define how it should behave");
    expect(mockPlan).not.toHaveBeenCalled();
  });
});
