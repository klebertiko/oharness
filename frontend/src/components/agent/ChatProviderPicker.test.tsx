import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useChatModelStore } from "@/store/chatModelStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";
import { ChatProviderPicker } from "./ChatProviderPicker";

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: "an", provider: "anthropic", label: "Anthropic", residence: "cloud",
    endpoint: "", secret: null, health: "live", detail: "", probes: [], facts: [],
    models: [], defaultModel: "", enabled: true,
    lastProbe: "", ...overrides,
  };
}

const setDefaultModel = vi.fn().mockResolvedValue(true);
const initialProvider = useProviderStore.getState();
const initialChat = useChatProviderStore.getState();
const initialSetupRequest = useChatSetupRequestStore.getState();

beforeEach(() => {
  useProviderStore.setState({
    connections: [
      connection({}),
      connection({ id: "oa", provider: "openai", label: "OpenAI", enabled: false, health: "setup" }),
      connection({ id: "ol", provider: "ollama", label: "Ollama local", residence: "local", health: "live", defaultModel: "llama3" }),
      connection({ id: "cu", provider: "cursor", label: "Cursor", enabled: false, health: "setup" }),
    ],
    selectedId: "an",
  });
  useChatProviderStore.setState({ chosenId: "an" });
  useChatSetupRequestStore.setState({ token: 0, id: null });
  useChatModelStore.setState({ overrides: {} });
  setDefaultModel.mockClear();
  useProviderStore.setState({ setDefaultModel });
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initialProvider, true);
  useChatProviderStore.setState(initialChat);
  useChatSetupRequestStore.setState(initialSetupRequest);
});

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /^chat provider:/i }));
  return screen.getByRole("listbox", { name: "Chat provider" });
};

it("lists Auto, the providers that can answer, and a Needs action group for the rest", async () => {
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);

  const names = within(list).getAllByRole("option").map((o) => o.textContent ?? "");
  expect(names).toHaveLength(4);
  expect(names[0]).toMatch(/^Auto/);
  // A connection with no model list is one row; one with models lists them under its name.
  expect(names[1]).toMatch(/^Anthropic/);
  expect(names[2]).toMatch(/^llama3/);
  expect(within(list).getByRole("group", { name: "Ollama local" })).toBeTruthy();
  // What cannot answer yet is offered with its one action, not as a choice and not as a form.
  const needs = within(within(list).getByRole("group", { name: "Needs action" })).getAllByRole("option");
  expect(needs).toHaveLength(1);
  expect(needs[0].textContent).toMatch(/^OpenAI.*Not connected · Turn on/);
  expect(document.querySelector("input[type=password]")).toBeNull();
});

it("a Needs action row opens that connection in Providers instead of selecting it", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  render(<ChatProviderPicker onConnect={onConnect} />);
  const list = await open(user);
  await user.click(within(list).getByRole("option", { name: /^OpenAI/ }));
  expect(useProviderStore.getState().selectedId).toBe("oa");
  expect(useChatProviderStore.getState().chosenId).toBe("an");
  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("Needs action lists three connections nearest to ready first, and counts the rest", async () => {
  const user = userEvent.setup();
  const off = (id: string, label: string, over: Partial<Connection> = {}) =>
    connection({ id, provider: "openrouter", label, enabled: false, health: "setup", ...over });
  useChatProviderStore.setState({ chosenId: null });
  useProviderStore.setState({
    connections: [
      off("k1", "No key one"),
      off("k2", "No key two"),
      off("rej", "Rejected", { health: "fault", enabled: true, detail: "401 unauthorized — the key was rejected or has been revoked." }),
      off("sw", "Switched off", { secret: { service: "oharness/sw", prefix: "", tail: "····", length: 0, vault: "backend", savedAt: "" } }),
    ],
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  const needs = within(within(list).getByRole("group", { name: "Needs action" })).getAllByRole("option").map((o) => o.textContent ?? "");
  expect(needs).toHaveLength(4);
  expect(needs[0]).toMatch(/^Switched off.*Turn on/);
  expect(needs[1]).toMatch(/^Rejected.*Key rejected · Replace key/);
  expect(needs[2]).toMatch(/^No key one.*Paste an OpenRouter key/);
  expect(needs[3]).toBe("1 more need setup. Open Manage providers.");
});

it("choosing a ready provider sets the chat default and closes", async () => {
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  await user.click(within(list).getByRole("option", { name: /^llama3/i }));
  expect(useChatProviderStore.getState().chosenId).toBe("ol");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("button", { name: /chat provider: ollama local · llama3.*verified/i })).toBeTruthy();
});

it("keeps a previously chosen provider that is no longer ready visible as the selection", async () => {
  const user = userEvent.setup();
  useChatProviderStore.setState({ chosenId: "oa" });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  const row = within(list).getByRole("option", { name: /^openai.*not connected/i });
  expect(row.getAttribute("aria-selected")).toBe("true");
});

it("shows a stale choice as unavailable when its connection is gone", async () => {
  const user = userEvent.setup();
  useChatProviderStore.setState({ chosenId: "gone" });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  expect(within(list).getByRole("option", { name: /unavailable provider.*no longer available/i }).getAttribute("aria-selected")).toBe("true");
});

it("sends setup to the Providers screen, naming how many connections need it", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  render(<ChatProviderPicker onConnect={onConnect} />);
  await open(user);
  // OpenAI is off; Cursor is delegation-only and not a chat setup item.
  await user.click(screen.getByRole("button", { name: /manage providers.*1 needs setup/i }));
  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("a setup request from the composer opens Providers on that connection instead of expanding a form", async () => {
  const onConnect = vi.fn();
  render(<ChatProviderPicker onConnect={onConnect} />);
  act(() => useChatSetupRequestStore.getState().requestSetup("oa"));
  expect(useProviderStore.getState().selectedId).toBe("oa");
  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("a setup request with no target opens the picker so the person can choose", async () => {
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  act(() => useChatSetupRequestStore.getState().requestSetup(null));
  expect(screen.getByRole("listbox", { name: "Chat provider" })).toBeTruthy();
});

it("with nothing ready, says so and offers the Providers screen", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  useChatProviderStore.setState({ chosenId: null });
  useProviderStore.setState({ connections: [connection({ id: "oa", provider: "openai", label: "OpenAI", enabled: false, health: "setup" })] });
  render(<ChatProviderPicker onConnect={onConnect} />);
  expect(screen.getByRole("button", { name: /chat provider: auto · no available provider/i })).toBeTruthy();
  await open(user);
  expect(screen.getByText(/no provider is ready/i)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /manage providers/i }));
  expect(onConnect).toHaveBeenCalledTimes(1);
});

it("the chip dot reads the connection's real state", () => {
  for (const [health, enabled, status] of [
    ["live", true, "Verified"],
    ["degraded", true, "Needs attention"],
    ["probing", true, "Checking connection"],
    ["fault", true, "Unavailable"],
    ["live", false, "Not connected"],
  ] as const) {
    useProviderStore.setState({ connections: [connection({ health, enabled })] });
    const { unmount } = render(<ChatProviderPicker onConnect={vi.fn()} />);
    const chip = screen.getByRole("button", { name: new RegExp("chat provider: anthropic.*" + status, "i") });
    expect(Boolean(chip.querySelector(".bg-signal"))).toBe(health === "live" && enabled);
    unmount();
  }
});

const models = (id: string) => [{ id: id + "-a", ctx: 0 }, { id: id + "-b", ctx: 0 }];

it("lists each ready connection's models under its name, and the chip says connection · model", async () => {
  const user = userEvent.setup();
  useProviderStore.setState({
    connections: [
      connection({ id: "an", label: "Anthropic", models: [{ id: "opus", ctx: 0 }, { id: "sonnet", ctx: 0 }], defaultModel: "sonnet" }),
      connection({ id: "ol", provider: "ollama", label: "Ollama local", residence: "local", models: models("g"), modelsFromEndpoint: true, defaultModel: "g-a" }),
    ],
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  expect(screen.getByRole("button", { name: /^chat provider: anthropic · sonnet/i })).toBeTruthy();
  const list = await open(user);
  expect(within(list).getByRole("group", { name: "Anthropic" })).toBeTruthy();
  expect(within(list).getAllByRole("option").map((o) => o.textContent?.split("Verified")[0].trim())).toEqual(
    expect.arrayContaining(["sonnet", "opus", "g-a", "g-b"]),
  );
  // The model in effect leads its group.
  const names = within(list).getAllByRole("option").map((o) => o.textContent ?? "");
  expect(names.findIndex((n) => n.startsWith("sonnet"))).toBeLessThan(names.findIndex((n) => n.startsWith("opus")));
});

it("Auto names where it lands: Auto → connection · model", () => {
  useChatProviderStore.setState({ chosenId: null });
  useProviderStore.setState({ connections: [connection({ id: "an", label: "Anthropic", defaultModel: "sonnet" })] });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  expect(screen.getByRole("button", { name: /^chat provider: auto → anthropic · sonnet/i })).toBeTruthy();
});

it("Enter on a model saves it as the connection default and drops this chat's own pin", async () => {
  const user = userEvent.setup();
  useChatModelStore.setState({ overrides: { new: { an: "opus" } } });
  useProviderStore.setState({ connections: [connection({ id: "an", label: "Anthropic", models: [{ id: "opus", ctx: 0 }, { id: "sonnet", ctx: 0 }], defaultModel: "sonnet" })] });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await open(user);
  await user.keyboard("son{Enter}");
  expect(setDefaultModel).toHaveBeenCalledWith("an", "sonnet");
  expect(useChatModelStore.getState().overrides).toEqual({});
});

it("Shift+Enter applies the model to this chat only and leaves the default alone", async () => {
  const user = userEvent.setup();
  useProviderStore.setState({ connections: [connection({ id: "an", label: "Anthropic", models: [{ id: "opus", ctx: 0 }, { id: "sonnet", ctx: 0 }], defaultModel: "sonnet" })] });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await open(user);
  await user.keyboard("opu{Shift>}{Enter}{/Shift}");
  expect(setDefaultModel).not.toHaveBeenCalled();
  expect(useChatModelStore.getState().overrides).toEqual({ new: { an: "opus" } });
  expect(screen.getByRole("button", { name: /chat provider: anthropic · opus.*this conversation only/i })).toBeTruthy();
});

it("the 'This chat only' toggle does the same for touch, where there is no Shift", async () => {
  const user = userEvent.setup();
  useProviderStore.setState({ connections: [connection({ id: "an", label: "Anthropic", models: [{ id: "opus", ctx: 0 }], defaultModel: "sonnet" })] });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  await user.click(screen.getByRole("radio", { name: "This chat only" }));
  await user.click(within(list).getByRole("option", { name: /^opus/ }));
  expect(setDefaultModel).not.toHaveBeenCalled();
  expect(useChatModelStore.getState().overrides).toEqual({ new: { an: "opus" } });
});

it("a model the list does not carry can be typed for the connection in use", async () => {
  const user = userEvent.setup();
  useProviderStore.setState({ connections: [connection({ id: "an", label: "Anthropic", models: [{ id: "opus", ctx: 0 }], defaultModel: "opus" })] });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await open(user);
  await user.keyboard("claude-next{Shift>}{Enter}{/Shift}");
  expect(useChatModelStore.getState().overrides).toEqual({ new: { an: "claude-next" } });
});

it("a connection with hundreds of models shows a capped slice and says how many more", async () => {
  const user = userEvent.setup();
  const many = Array.from({ length: 300 }, (_v, i) => ({ id: `vendor/model-${i}`, ctx: 0 }));
  useProviderStore.setState({ connections: [connection({ id: "or", provider: "openrouter", label: "OpenRouter", models: many, modelsFromEndpoint: true, defaultModel: "vendor/model-7" })] });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  expect(within(list).getAllByRole("option").length).toBeLessThan(40);
  await user.keyboard("model-29");
  const rows = within(list).getAllByRole("option").map((o) => o.textContent ?? "");
  expect(rows.some((r) => r.startsWith("vendor/model-29"))).toBe(true);
  expect(rows.every((r) => !r.startsWith("vendor/model-3"))).toBe(true);
});

it("a connection that only lacks a model is listed, so picking a model is how it becomes ready", async () => {
  const user = userEvent.setup();
  useChatProviderStore.setState({ chosenId: null });
  useProviderStore.setState({
    connections: [connection({ id: "ol", provider: "ollama", label: "Ollama local", residence: "local", models: models("g"), modelsFromEndpoint: true, defaultModel: "missing:1b" })],
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  expect(within(list).getByRole("group", { name: "Ollama local" })).toBeTruthy();
  await user.click(within(list).getByRole("option", { name: /^g-a/ }));
  expect(setDefaultModel).toHaveBeenCalledWith("ol", "g-a");
});

it("a custom model pinned to this chat is listed and marked as the selection", async () => {
  const user = userEvent.setup();
  useChatModelStore.setState({ overrides: { new: { an: "my-custom" } } });
  useProviderStore.setState({ connections: [connection({ id: "an", label: "Anthropic", models: [{ id: "opus", ctx: 0 }], defaultModel: "opus" })] });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  expect(within(list).getByRole("option", { name: /^my-custom/ }).getAttribute("aria-selected")).toBe("true");
});

it("two connections with the same name and the same model stay two rows with the right ids", async () => {
  const user = userEvent.setup();
  useChatProviderStore.setState({ chosenId: null });
  useProviderStore.setState({
    connections: [
      connection({ id: "a", label: "Ollama", provider: "ollama", residence: "local", models: [{ id: "llama3", ctx: 0 }], modelsFromEndpoint: true, defaultModel: "llama3" }),
      connection({ id: "b", label: "Ollama", provider: "ollama", residence: "local", models: [{ id: "llama3", ctx: 0 }], modelsFromEndpoint: true, defaultModel: "llama3" }),
    ],
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  expect(within(list).getAllByRole("option", { name: /^llama3/ })).toHaveLength(2);
  await user.keyboard("llama{ArrowDown}{Enter}");
  expect(useChatProviderStore.getState().chosenId).toBe("b");
});

it("the typed-model row is offered for the connection in use even when another connection has that model", async () => {
  const user = userEvent.setup();
  useChatProviderStore.setState({ chosenId: "an" });
  useProviderStore.setState({
    connections: [
      connection({ id: "an", label: "Anthropic", models: [{ id: "opus", ctx: 0 }], defaultModel: "opus" }),
      connection({ id: "ol", provider: "ollama", label: "Ollama local", residence: "local", models: [{ id: "gpt-x", ctx: 0 }], modelsFromEndpoint: true, defaultModel: "gpt-x" }),
    ],
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  await user.keyboard("gpt-x");
  expect(within(list).getByRole("option", { name: /use .gpt-x./i })).toBeTruthy();
});

it("the pick fails to save: the chat keeps its own pin", async () => {
  const user = userEvent.setup();
  setDefaultModel.mockResolvedValueOnce(false);
  useChatModelStore.setState({ overrides: { new: { an: "opus" } } });
  useProviderStore.setState({ connections: [connection({ id: "an", label: "Anthropic", models: [{ id: "opus", ctx: 0 }, { id: "sonnet", ctx: 0 }], defaultModel: "sonnet" })] });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await open(user);
  await user.keyboard("son{Enter}");
  expect(setDefaultModel).toHaveBeenCalledWith("an", "sonnet");
  expect(useChatModelStore.getState().overrides).toEqual({ new: { an: "opus" } });
});

it("while a harness runs the turn, there is no 'this chat only' scope to offer", async () => {
  const user = userEvent.setup();
  useProviderStore.setState({ connections: [connection({ id: "an", label: "Anthropic", models: [{ id: "opus", ctx: 0 }, { id: "sonnet", ctx: 0 }], defaultModel: "sonnet" })] });
  render(<ChatProviderPicker onConnect={vi.fn()} modelAppliesToChat={false} />);
  await open(user);
  expect(screen.queryByRole("radio", { name: "This chat only" })).toBeNull();
  await user.keyboard("opu{Shift>}{Enter}{/Shift}");
  expect(setDefaultModel).toHaveBeenCalledWith("an", "opus");
  expect(useChatModelStore.getState().overrides).toEqual({});
});

it("pins of chats that no longer exist are dropped, the pre-chat pin stays", () => {
  useChatModelStore.setState({ overrides: { gone: { an: "x" }, new: { an: "y" } } });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  expect(useChatModelStore.getState().overrides).toEqual({ new: { an: "y" } });
});

it("the composer's call to action uses the same words as the Needs action row", async () => {
  const user = userEvent.setup();
  useChatProviderStore.setState({ chosenId: null });
  useProviderStore.setState({
    connections: [connection({ id: "sw", provider: "anthropic", label: "Anthropic", enabled: false, health: "setup" })],
  });
  const { missingProviderAction } = await import("@/components/providers/composerAction");
  const cta = missingProviderAction(useProviderStore.getState().connections, null);
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  const row = within(list).getByRole("option", { name: /^Anthropic/ });
  expect(cta?.text).toBe("Turn on · Anthropic");
  expect(row.textContent).toContain("Turn on");
});

it("more than three connections that need action: three rows and a count of the rest", async () => {
  const user = userEvent.setup();
  useChatProviderStore.setState({ chosenId: null });
  useProviderStore.setState({
    connections: ["a", "b", "c", "d", "e"].map((id) => connection({ id, provider: "openrouter", label: `Router ${id}`, enabled: false, health: "setup" })),
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  const group = within(list).getByRole("group", { name: "Needs action" });
  expect(within(group).getAllByRole("option").map((o) => o.textContent)).toEqual([
    expect.stringMatching(/^Router a/), expect.stringMatching(/^Router b/), expect.stringMatching(/^Router c/),
    "2 more need setup. Open Manage providers.",
  ]);
});
