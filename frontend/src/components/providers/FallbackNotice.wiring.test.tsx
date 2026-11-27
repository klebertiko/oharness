import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startDirectRunMock = vi.fn();
const startRunMock = vi.fn();
vi.mock("@/components/agent-run/runClient", () => ({
  startDirectRun: (...args: unknown[]) => startDirectRunMock(...args),
  startRun: (...args: unknown[]) => startRunMock(...args),
  sendControl: vi.fn().mockResolvedValue(undefined),
}));

import { useRunStream } from "@/components/agent-run/useRunStream";
import { useLocaleStore } from "@/i18n/store";
import { useChatFallbackStore } from "@/store/chatFallbackStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { ChatFallbackNotice } from "./FallbackNotice";
import { useProviderStore, type Connection } from "./providerStore";

const account = (id: string, label: string): Connection => ({
  id, provider: id === "an" ? "anthropic" : "openrouter", label, residence: "cloud", endpoint: "", secret: null,
  health: "live", detail: "", probes: [], facts: [], models: [], defaultModel: "", enabled: true, lastProbe: "",
});

const initialProviders = useProviderStore.getState();

beforeEach(() => {
  startDirectRunMock.mockReset().mockReturnValue(vi.fn());
  startRunMock.mockReset().mockReturnValue(vi.fn());
  useProviderStore.setState({ connections: [account("an", "Pessoal"), account("or", "Empresa")] });
  useChatProviderStore.setState({ chosenId: "an" });
  useChatFallbackStore.setState({ notice: null });
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initialProviders, true);
  useLocaleStore.setState({ locale: "en" });
});

const emptyGraph = { nodes: [], edges: [] };

function directTurn(providerId = "an") {
  const { result } = renderHook(() => useRunStream({ graph: emptyGraph, harnessEnabled: false }));
  act(() => result.current.start({ instruction: "hi", mode: "live", step: false, providerId }));
  return startDirectRunMock.mock.calls.at(-1)![1] as (event: string, data: Record<string, unknown>) => void;
}

describe("the run's failover signal drives the chat", () => {
  it("records who answered and why, and the chat follows the account that answered", () => {
    const onEvent = directTurn();
    act(() => onEvent("node_start", {
      node_id: "direct", connection_id: "or",
      failover: { attempts: [{ connection_id: "an", reason_class: "usage_limit", reason: "CANARY person@example.com" }] },
    }));
    expect(useChatFallbackStore.getState().notice).toEqual({ fromId: "an", toId: "or", reason: "usage_limit", previous: "an" });
    expect(JSON.stringify(useChatFallbackStore.getState())).not.toContain("CANARY");
    expect(useChatProviderStore.getState().chosenId).toBe("or");
  });

  it("reads an unknown class as a plain failure, never as text", () => {
    const onEvent = directTurn();
    act(() => onEvent("node_start", { node_id: "direct", connection_id: "or", failover: { attempts: [{ connection_id: "an", reason_class: "the CLI said: boom" }] } }));
    expect(useChatFallbackStore.getState().notice?.reason).toBe("failed");
  });

  it("ignores a start with no failover, or one that did not start from the chat's account", () => {
    const onEvent = directTurn();
    act(() => onEvent("node_start", { node_id: "direct", connection_id: "an" }));
    act(() => onEvent("node_start", { node_id: "direct", connection_id: "or", failover: { attempts: [{ connection_id: "other", reason_class: "failed" }] } }));
    expect(useChatFallbackStore.getState().notice).toBeNull();
    expect(useChatProviderStore.getState().chosenId).toBe("an");
  });

  it("a harness run never moves the chat's choice", () => {
    const { result } = renderHook(() => useRunStream({ graph: emptyGraph, harnessEnabled: true }));
    act(() => result.current.start({ instruction: "hi", mode: "live", step: false, providerId: "an" }));
    const onEvent = startRunMock.mock.calls.at(-1)![1] as (event: string, data: Record<string, unknown>) => void;
    act(() => onEvent("node_start", { node_id: "n1", connection_id: "or", failover: { attempts: [{ connection_id: "an", reason_class: "failed" }] } }));
    expect(useChatFallbackStore.getState().notice).toBeNull();
  });
});

describe("the chat's fallback notice", () => {
  it("says who answered and why, and Back returns the chat to the previous choice", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    useChatFallbackStore.setState({ notice: { fromId: "an", toId: "or", reason: "usage_limit", previous: null } });
    useChatProviderStore.setState({ chosenId: "or" });
    render(<ChatFallbackNotice />);
    expect(screen.getByText("Respondido por Empresa porque Pessoal atingiu o limite de uso")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar para Pessoal" }));
    expect(useChatProviderStore.getState().chosenId).toBeNull();
    expect(useChatFallbackStore.getState().notice).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("goes away when the person picks another account themselves", () => {
    useChatFallbackStore.setState({ notice: { fromId: "an", toId: "or", reason: "failed", previous: "an" } });
    useChatProviderStore.setState({ chosenId: "or" });
    render(<ChatFallbackNotice />);
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => useChatProviderStore.setState({ chosenId: null }));
    expect(useChatFallbackStore.getState().notice).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
