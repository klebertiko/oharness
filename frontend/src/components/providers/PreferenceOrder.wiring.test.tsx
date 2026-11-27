import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { ProvidersScreen } from "./ProvidersScreen";
import { useProviderStore, type Connection } from "./providerStore";
import { useUsageStore } from "./usageStore";

vi.mock("@/lib/usageApi", () => ({ usageApi: { summary: vi.fn(), setBudget: vi.fn() } }));

const account = (over: Partial<Connection>): Connection => ({
  id: "openrouter", provider: "openrouter", label: "Empresa", residence: "cloud", endpoint: "https://openrouter.ai/api/v1",
  secret: { service: "oharness/openrouter", prefix: "", tail: "····", length: 0, vault: "backend", savedAt: "" },
  health: "live", detail: "", probes: [], facts: [], models: [{ id: "deepseek/deepseek-v4", ctx: 0 }],
  defaultModel: "deepseek/deepseek-v4", enabled: true, lastProbe: "", ...over,
});
const personal = account({ id: "anthropic", provider: "anthropic", label: "Pessoal", secret: null, endpoint: "", models: [], defaultModel: "" });

const initialProviders = useProviderStore.getState();
const initialUsage = useUsageStore.getState();
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).endsWith("/providers/clis") ? { clis: [] } : {}) }));
  vi.stubGlobal("fetch", fetchMock);
  useUsageStore.setState({ ...initialUsage, hydrated: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useProviderStore.setState(initialProviders, true);
  useUsageStore.setState(initialUsage, true);
  useLocaleStore.setState({ locale: "en" });
});

const show = (list: Connection[]) => {
  useProviderStore.setState({ connections: list, selectedId: list[0]?.id ?? "", loadState: "ready" });
  return render(<ProvidersScreen />);
};
const calls = (suffix: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(suffix) && (init as RequestInit | undefined)?.method === "PUT");

describe("preference order on the Providers screen", () => {
  it("is not shown with fewer than two accounts that can answer", () => {
    show([personal, account({ enabled: false, health: "setup", secret: null })]);
    expect(screen.queryByRole("list", { name: "Preference order" })).toBeNull();
  });

  it("lists the accounts in the saved order and saves a new order", async () => {
    show([{ ...personal, rank: 1 }, account({ rank: 0 })]);
    const list = screen.getByRole("list", { name: "Preference order" });
    const labels = [...list.querySelectorAll("input")].map((input) => input.value);
    expect(labels).toEqual(["Empresa", "Pessoal"]);

    fireEvent.click(screen.getByRole("button", { name: "Move Pessoal up" }));
    await waitFor(() => expect(calls("/providers/preference")).toHaveLength(1));
    const [, init] = calls("/providers/preference")[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ order: ["anthropic", "openrouter"] });
    await waitFor(() => expect(useProviderStore.getState().connections.find((c) => c.id === "anthropic")?.rank).toBe(0));
  });

  it("renames an account through the connection update, once, when the field is left", async () => {
    show([personal, account({})]);
    const field = screen.getByRole("textbox", { name: "Label for Pessoal" });
    fireEvent.change(field, { target: { value: "  Casa  " } });
    expect(calls("/providers/connections/anthropic")).toHaveLength(0);
    fireEvent.blur(field);
    await waitFor(() => expect(calls("/providers/connections/anthropic")).toHaveLength(1));
    const [, init] = calls("/providers/connections/anthropic")[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ label: "Casa" });
    expect(useProviderStore.getState().connections.find((c) => c.id === "anthropic")?.label).toBe("Casa");
  });

  it("puts the old name back when the sidecar refuses the rename", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      String(url).endsWith("/providers/connections/anthropic") && init?.method === "PUT"
        ? { ok: false, status: 422, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ clis: [] }) },
    );
    show([personal, account({})]);
    const field = screen.getByRole("textbox", { name: "Label for Pessoal" });
    fireEvent.change(field, { target: { value: "Casa" } });
    fireEvent.blur(field);
    await waitFor(() => expect(calls("/providers/connections/anthropic")).toHaveLength(1));
    await waitFor(() => expect(useProviderStore.getState().connections.find((c) => c.id === "anthropic")?.label).toBe("Pessoal"));
  });
});
