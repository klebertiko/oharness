import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import type { Connection } from "@/components/providers/providerStore";
import { useProviderStore } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";

import { AgentStage } from "./AgentStage";

const { resetRunMock } = vi.hoisted(() => ({ resetRunMock: vi.fn() }));

vi.mock("@/components/agent-run/useRunStream", () => ({
  useRunStream: () => ({
    run: { runId: null, status: "idle", plan: [], totals: { tokens: 0, nodesRun: 0, elapsedMs: 0 } },
    elapsed: 0,
    live: false,
    reset: resetRunMock,
    start: vi.fn(),
    stop: vi.fn(),
    advance: vi.fn(),
    resolveGate: vi.fn(),
  }),
}));

vi.mock("@/components/agent/HarnessBar", () => ({
  HarnessBar: () => <div data-testid="harness-bar" />,
}));

vi.mock("@/components/agent/ChatProviderPicker", () => ({
  ChatProviderPicker: () => <div data-testid="chat-provider-picker" />,
}));

vi.mock("@/components/agent/WorkspacePicker", () => ({
  WorkspacePicker: () => <div data-testid="workspace-picker" />,
}));

vi.mock("@/components/agent-run/Gate", () => ({
  Gate: () => null,
}));

vi.mock("@/components/agent-run/Transcript", () => ({
  Transcript: () => null,
}));

/**
 * Chat-only stage: a Cowork tab must not appear (palette Task 5).
 */
describe("AgentStage chat-only surface", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    resetRunMock.mockClear();
    useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
    useHarnessSessionStore.setState({
      hydrated: true,
      enabled: true,
      activeBundle: null,
      hydrate: async () => undefined,
    });
  });

  it("does not expose a Cowork tablist", () => {
    render(<AgentStage />);

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab", { name: /^chat$/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^cowork$/i })).toBeNull();
    expect(screen.queryByText("Cowork")).toBeNull();
  });

  it("New chat clears the previous run, empties the composer, and focuses it", () => {
    const id = useThreadStore.getState().createThread("Existing chat");
    useThreadStore.getState().appendMessage(id, { role: "user", content: "Keep this history" });
    render(<AgentStage />);
    resetRunMock.mockClear();

    act(() => useThreadStore.getState().startNewChat());

    const composer = screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
    expect(resetRunMock).toHaveBeenCalledTimes(1);
    expect(composer.value).toBe("");
    expect(document.activeElement).toBe(composer);
    expect(useThreadStore.getState().messagesByThread[id][0].content).toBe("Keep this history");
  });
});

/** Minimal, valid Connection fixture — only the fields this stage reads. */
function makeConnection(overrides: Partial<Connection>): Connection {
  return {
    id: "conn",
    provider: "anthropic",
    label: "Connection",
    residence: "cloud",
    endpoint: "",
    secret: null,
    health: "live",
    detail: "",
    probes: [],
    facts: [],
    models: [],
    defaultModel: "",
    enabled: true,
    lastProbe: "",
    ...overrides,
  };
}

/**
 * The chat composer's provider chip: `pickChatProvider` resolves the chip
 * connection (chosen pick, or Auto — first live connection), and that id is
 * what `bundleGraphToEngine` carries into the graph as the fallback for any
 * unpinned node (mirrors `resolve_node_provider`'s documented precedence in
 * backend/providers/resolution.py). Chat is never mock — with nothing
 * connected, the composer names the gap and points at Providers instead of
 * silently allowing a send that can't go anywhere.
 */
describe("AgentStage provider gating", () => {
  afterEach(() => {
    cleanup();
    useChatProviderStore.setState({ chosenId: null });
  });

  beforeEach(() => {
    useHarnessSessionStore.setState({
      hydrated: true,
      enabled: false,
      activeBundle: null,
      hydrate: async () => undefined,
    });
  });

  it("empty state names the missing action instead of a bare 'Unavailable' — never a dead click", () => {
    useProviderStore.setState({ connections: [], selectedId: "" });

    render(<AgentStage />);

    // design.md § Provider stance: state exactly what's missing, as an
    // action — never "No provider connected." dead text.
    expect(screen.queryByText(/no provider connected/i)).toBeNull();
    expect(screen.getAllByRole("button", { name: /connect a provider to send/i }).length).toBeGreaterThan(0);
  });

  it("empty state names the specific fix for an explicit, not-ready choice", () => {
    useProviderStore.setState({
      connections: [makeConnection({ id: "anthropic", label: "Anthropic", provider: "anthropic", enabled: false })],
      selectedId: "",
    });
    useChatProviderStore.setState({ chosenId: "anthropic" });

    render(<AgentStage />);

    // Anthropic's catalog credential is "cli" — a switch, not a key paste.
    expect(screen.getAllByRole("button", { name: /turn on anthropic to send/i }).length).toBeGreaterThan(0);
  });

  it("empty state shows the connected provider's label once one is live", () => {
    useProviderStore.setState({
      connections: [makeConnection({ id: "anthropic", label: "Anthropic", enabled: true })],
      selectedId: "",
    });

    render(<AgentStage />);

    expect(screen.queryByText(/no provider connected/i)).toBeNull();
    expect(screen.getByText("Anthropic")).toBeTruthy();
  });

  it("send stays disabled with no instruction even when a provider is connected", () => {
    useProviderStore.setState({
      connections: [makeConnection({ id: "anthropic", label: "Anthropic", enabled: true })],
      selectedId: "anthropic",
    });

    render(<AgentStage />);

    expect((screen.getByRole("button", { name: /send message/i }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});
