import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useChatModelStore } from "@/store/chatModelStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { CHAT_RECENT_STORAGE_KEY, useChatRecentStore } from "@/store/chatRecentStore";
import { ChatProviderPicker } from "./ChatProviderPicker";

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: "an", provider: "anthropic", label: "Pessoal", residence: "cloud",
    endpoint: "", secret: null, health: "live", detail: "", probes: [], facts: [],
    models: [{ id: "claude-opus-5", ctx: 200000, price: [15, 75] }, { id: "claude-haiku-4-5", ctx: 200000, price: [0.8, 4] }],
    defaultModel: "claude-opus-5", enabled: true, lastProbe: "", ...overrides,
  };
}
const metered = (overrides: Partial<Connection> = {}) =>
  connection({
    id: "or", provider: "openrouter", label: "Empresa", endpoint: "https://openrouter.ai/api/v1",
    secret: { service: "oharness/or", prefix: "", tail: "····", length: 0, vault: "backend", savedAt: "" },
    models: [{ id: "anthropic/claude-opus-5", ctx: 200000, price: [15, 75] }, { id: "deepseek/deepseek-v4", ctx: 164000, price: [0.28, 1.1] }],
    defaultModel: "anthropic/claude-opus-5",
    ...overrides,
  });

const setDefaultModel = vi.fn().mockResolvedValue(true);
const initialProvider = useProviderStore.getState();

beforeEach(() => {
  localStorage.clear();
  useChatRecentStore.setState({ recent: [] });
  useChatProviderStore.setState({ chosenId: "an" });
  useChatModelStore.setState({ overrides: {} });
  setDefaultModel.mockClear();
  useProviderStore.setState({ connections: [connection({}), metered()], selectedId: "an", setDefaultModel });
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initialProvider, true);
});

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /^chat provider:/i }));
  return screen.getByRole("listbox", { name: "Chat provider" });
};
const optionNames = (list: HTMLElement) => within(list).getAllByRole("option").map((o) => o.textContent ?? "");

it("remembers the last five model picks and lists them as Recent", async () => {
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  let list = await open(user);
  expect(within(list).queryByRole("group", { name: "Recent" })).toBeNull();

  await user.click(within(within(list).getByRole("group", { name: "Empresa" })).getByRole("option", { name: /deepseek\/deepseek-v4/ }));
  expect(useChatRecentStore.getState().recent).toEqual([{ connectionId: "or", model: "deepseek/deepseek-v4" }]);
  expect(JSON.parse(localStorage.getItem(CHAT_RECENT_STORAGE_KEY) ?? "{}").state.recent).toEqual([{ connectionId: "or", model: "deepseek/deepseek-v4" }]);

  list = await open(user);
  const recent = within(list).getByRole("group", { name: "Recent" });
  expect(within(recent).getAllByRole("option").map((o) => o.textContent ?? "")[0]).toContain("deepseek/deepseek-v4");

  useChatProviderStore.setState({ chosenId: "an" });
  setDefaultModel.mockClear();
  await user.click(within(recent).getByRole("option", { name: /deepseek\/deepseek-v4/ }));
  expect(useChatProviderStore.getState().chosenId).toBe("or");
  expect(setDefaultModel).toHaveBeenCalledWith("or", "deepseek/deepseek-v4");

  for (let n = 0; n < 6; n += 1) useChatRecentStore.getState().remember({ connectionId: "or", model: `m${n}` });
  expect(useChatRecentStore.getState().recent).toHaveLength(5);
  expect(useChatRecentStore.getState().recent[0].model).toBe("m5");
});

it("leaves out a recent pick whose account can no longer answer", async () => {
  useChatRecentStore.setState({ recent: [{ connectionId: "or", model: "deepseek/deepseek-v4" }] });
  useProviderStore.setState({ connections: [connection({}), metered({ enabled: false, health: "setup" })] });
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  expect(within(list).queryByRole("group", { name: "Recent" })).toBeNull();
});

it("offers Cheapest from the list prices of metered accounts and picks that model", async () => {
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  const names = optionNames(list);
  expect(names.some((n) => /^Best|^Fastest/.test(n))).toBe(false);
  const cheapest = within(list).getByRole("option", { name: /^Cheapest/ });
  // A subscription's list price is not what it costs: only the metered account's models are compared.
  expect(cheapest.textContent).toContain("deepseek/deepseek-v4");
  expect(cheapest.textContent).toContain("Empresa");
  await user.click(cheapest);
  expect(useChatProviderStore.getState().chosenId).toBe("or");
  expect(setDefaultModel).toHaveBeenCalledWith("or", "deepseek/deepseek-v4");
});

it("does not offer Cheapest without two priced models on metered accounts", async () => {
  useProviderStore.setState({ connections: [connection({}), metered({ models: [{ id: "deepseek/deepseek-v4", ctx: 0, price: [0.28, 1.1] }] })] });
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  expect(within(list).queryByRole("option", { name: /^Cheapest/ })).toBeNull();
});
