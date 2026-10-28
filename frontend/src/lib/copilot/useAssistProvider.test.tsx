import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { missingProviderAction } from "@/components/providers/composerAction";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useShellStore } from "@/components/shell/shellStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";
import { useAssistProvider } from "./useAssistProvider";

const conn = (over: Partial<Connection>): Connection =>
  ({
    id: "c1",
    provider: "anthropic",
    label: "Claude",
    residence: "cloud",
    endpoint: "",
    secret: null,
    health: "live",
    detail: "",
    probes: [],
    facts: [],
    models: [],
    defaultModel: "",
    route: [],
    routeSort: "price",
    allowed: [],
    enabled: true,
    lastProbe: "",
    ...over,
  }) as Connection;

const initial = {
  providers: useProviderStore.getState(),
  chat: useChatProviderStore.getState(),
  setup: useChatSetupRequestStore.getState(),
};

beforeEach(() => {
  useChatProviderStore.setState({ chosenId: null });
  useChatSetupRequestStore.setState({ token: 0, id: null });
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initial.providers);
  useChatProviderStore.setState(initial.chat);
  useChatSetupRequestStore.setState(initial.setup);
});

describe("useAssistProvider", () => {
  it("a ready cloud connection means live mode with its id", () => {
    useProviderStore.setState({ connections: [conn({ id: "cloud-1" })] });
    const { result } = renderHook(() => useAssistProvider());
    expect(result.current).toMatchObject({ mode: "live", connectionId: "cloud-1", missing: null });
    expect(result.current.provider).toMatchObject({ id: "cloud-1", label: "Claude" });
  });

  it("a local connection means local mode", () => {
    useProviderStore.setState({ connections: [conn({ id: "ol", provider: "ollama", residence: "local", label: "Ollama", endpoint: "http://127.0.0.1:11434/v1", defaultModel: "llama3" })] });
    const { result } = renderHook(() => useAssistProvider());
    expect(result.current).toMatchObject({ mode: "local", connectionId: "ol" });
  });

  it("an explicit choice wins over Auto", () => {
    useProviderStore.setState({ connections: [conn({ id: "a" }), conn({ id: "b", label: "Other" })] });
    useChatProviderStore.setState({ chosenId: "b" });
    const { result } = renderHook(() => useAssistProvider());
    expect(result.current.connectionId).toBe("b");
  });

  it("no provider means offline mock mode and the chat's own missing-provider text", () => {
    const connections = [conn({ enabled: false, health: "setup" })];
    useProviderStore.setState({ connections });
    const { result } = renderHook(() => useAssistProvider());
    expect(result.current).toMatchObject({ mode: "mock", connectionId: null, provider: null });
    expect(result.current.missing!.text).toBe(missingProviderAction(connections, null)!.text);
  });

  it("an explicit but unavailable choice reports that connection and never falls back to another", () => {
    useProviderStore.setState({ connections: [conn({ id: "ready" }), conn({ id: "off", enabled: false, health: "setup", label: "Off" })] });
    useChatProviderStore.setState({ chosenId: "off" });
    const { result } = renderHook(() => useAssistProvider());
    expect(result.current).toMatchObject({ mode: "mock", connectionId: null, provider: null });
    expect(result.current.missing!.id).toBe("off");
  });

  it("requestSetup asks the chat setup flow for the missing connection", () => {
    useProviderStore.setState({ connections: [conn({ id: "off", enabled: false, health: "setup" })] });
    useChatProviderStore.setState({ chosenId: "off" });
    const { result } = renderHook(() => useAssistProvider());
    act(() => result.current.requestSetup());
    expect(useChatSetupRequestStore.getState()).toMatchObject({ id: "off", token: 1 });
  });

  it("requestSetup opens Providers when there is nothing concrete to expand", () => {
    useProviderStore.setState({ connections: [] });
    useShellStore.setState({ section: "studio" });
    const { result } = renderHook(() => useAssistProvider());
    act(() => result.current.requestSetup());
    expect(useShellStore.getState().section).toBe("providers");
    expect(useChatSetupRequestStore.getState().token).toBe(0);
  });
});
