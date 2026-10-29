import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { usageApi } from "@/lib/usageApi";
import { axeViolations } from "@/test/axe";
import { ProvidersScreen } from "./ProvidersScreen";
import { useProviderStore, type Connection } from "./providerStore";
import { useUsageStore } from "./usageStore";

vi.mock("@/lib/usageApi", () => ({ usageApi: { summary: vi.fn(), setBudget: vi.fn() } }));

const conn = (over: Partial<Connection>): Connection => ({
  id: "ollama-local", provider: "ollama", label: "Ollama local", residence: "local", endpoint: "http://127.0.0.1:11434/v1",
  secret: null, health: "live", detail: "", probes: [], facts: [], models: [{ id: "gemma4:26b", ctx: 0 }, { id: "nomic-embed-text:latest", ctx: 0 }],
  modelsFromEndpoint: true, defaultModel: "", enabled: true, lastProbe: "", ...over,
});
const router = (over: Partial<Connection> = {}) =>
  conn({
    id: "openrouter", provider: "openrouter", label: "OpenRouter", residence: "cloud", endpoint: "https://openrouter.ai/api/v1",
    models: [{ id: "deepseek/deepseek-v4", ctx: 128000, via: "DeepSeek" }], modelsFromEndpoint: false, defaultModel: "deepseek/deepseek-v4", ...over,
  });
const sealed = { service: "oharness/openrouter", prefix: "sk-or-", tail: "9f3a", length: 40, vault: "backend" as const, savedAt: "" };

const initialProviders = useProviderStore.getState();
const initialUsage = useUsageStore.getState();
const show = (list: Connection[], actions: Record<string, unknown> = {}, selectedId = list[0]?.id ?? "") => {
  useProviderStore.setState({ connections: list, selectedId, loadState: "ready", ...actions });
  return render(<ProvidersScreen />);
};

beforeEach(() => {
  vi.clearAllMocks();
  useUsageStore.setState({ ...initialUsage, hydrated: true });
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initialProviders, true);
  useUsageStore.setState(initialUsage, true);
  useLocaleStore.setState({ locale: "en" });
});

describe("list", () => {
  it("groups by what to do, nearest to answering first, and says one word and one step per row", () => {
    show([
      conn({ id: "a", provider: "anthropic", label: "Anthropic", health: "live", enabled: true }),
      router({ id: "b", label: "Key row", enabled: false, secret: null, health: "setup" }),
      conn({ id: "c", label: "Needs model", defaultModel: "", health: "setup" }),
    ]);
    const headings = within(screen.getByRole("complementary")).getAllByRole("heading", { level: 3 }).map((h) => h.textContent).filter((h) => h !== "Spend");
    expect(headings).toEqual(["Needs action", "Ready"]);
    const rows = within(screen.getByRole("complementary")).getAllByRole("button").map((b) => b.textContent ?? "");
    expect(rows[0]).toContain("Needs model");
    expect(rows[0]).toContain("choose model");
    expect(rows[1]).toContain("Key row");
    expect(rows[1]).toContain("add key");
    expect(rows[2]).toContain("Anthropic");
  });

  it("with nothing picked, the detail is the connection nearest to answering; picking another replaces it", async () => {
    show([router({ enabled: false, health: "setup", secret: null }), conn({ health: "setup", defaultModel: "" })], {}, "");
    expect(screen.getByRole("heading", { level: 2, name: "Ollama local" })).toBeTruthy();
    await userEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /OpenRouter/ }));
    expect(screen.getByRole("heading", { level: 2, name: "OpenRouter" })).toBeTruthy();
    expect(useProviderStore.getState().selectedId).toBe("openrouter");
  });

  it("Back clears the pick so the narrow layout returns to the list", async () => {
    show([router()]);
    await userEvent.click(screen.getByRole("button", { name: "Providers" }));
    expect(useProviderStore.getState().selectedId).toBe("");
  });

  it("tells a fresh install what to do and puts no mascot or invented number on the screen", () => {
    show([router({ enabled: false, health: "setup", secret: null })]);
    expect(screen.getByText("Nothing is connected yet")).toBeTruthy();
    expect(screen.getByText("0 of 1 ready")).toBeTruthy();
  });
});

describe("review fixes", () => {
  it("holds the default connection once picked: it does not swap when that connection becomes ready", async () => {
    show([conn({ health: "setup", defaultModel: "" }), router({ enabled: false, health: "setup", secret: null })], {}, "");
    expect(screen.getByRole("heading", { level: 2, name: "Ollama local" })).toBeTruthy();
    act(() => useProviderStore.setState({ connections: [conn({ health: "live", defaultModel: "gemma4:26b" }), router({ enabled: false, health: "setup", secret: null })] }));
    expect(screen.getByRole("heading", { level: 2, name: "Ollama local" })).toBeTruthy();
  });

  it("Cancel on a replacement clears the entry, so Replace again starts clean", async () => {
    show([router({ secret: sealed })]);
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    await userEvent.type(screen.getByLabelText("Paste your OpenRouter key"), "sk-ant-x");
    expect(screen.getByText(/keys begin sk-or-/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.queryByText(/keys begin sk-or-/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save key" }).hasAttribute("disabled")).toBe(true);
  });

  it("Cancel in the removal confirmation puts focus back on Remove's neighbour, Replace", async () => {
    show([router({ secret: sealed })]);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Replace" })));
  });

  it("accepts a decimal comma in the budget and rejects exponent and hex forms", async () => {
    vi.mocked(usageApi.setBudget).mockResolvedValue(undefined as never);
    vi.mocked(usageApi.summary).mockResolvedValue({ byConnection: [], budget: { limitUsd: 15.5, state: "ok" } } as never);
    show([router()]);
    await userEvent.click(screen.getByRole("button", { name: "No budget. Set one" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Global budget in USD" }), { target: { value: "1e3" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/zero or a positive/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Global budget in USD" }), { target: { value: "15,50" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(usageApi.setBudget).toHaveBeenCalledWith(15.5));
  });

  it("a failed budget save shows its own message and not the stale-usage notice", async () => {
    vi.mocked(usageApi.setBudget).mockRejectedValue(new Error("nope"));
    show([router()]);
    await userEvent.click(screen.getByRole("button", { name: "No budget. Set one" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Global budget in USD" }), { target: { value: "5" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Couldn't save the budget/)).toBeTruthy();
    expect(screen.queryByText(/Usage may be out of date/)).toBeNull();
  });

  it("Blur then Test share one endpoint save", async () => {
    let release: (v: boolean) => void = () => {};
    const saveEndpoint = vi.fn(() => new Promise<boolean>((r) => (release = r)));
    const probe = vi.fn().mockResolvedValue(undefined);
    show([conn({ defaultModel: "gemma4:26b" })], { saveEndpoint, probe });
    const field = screen.getByRole("textbox", { name: "Ollama local endpoint" });
    fireEvent.change(field, { target: { value: "http://127.0.0.1:11500/v1" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    release(true);
    await waitFor(() => expect(probe).toHaveBeenCalled());
    expect(saveEndpoint).toHaveBeenCalledOnce();
  });

  it("offline, the panels that would read as evidence are not shown", () => {
    show([router({ secret: null })], { loadState: "offline", hydrate: vi.fn() });
    expect(screen.queryByLabelText("Paste your OpenRouter key")).toBeNull();
    expect(screen.queryByText("No usage recorded yet.")).toBeNull();
    expect(screen.getByText(/once the sidecar answers/)).toBeTruthy();
  });
});

describe("states", () => {
  it("loading: skeleton rows, no false 'Not connected'", () => {
    show([router({ enabled: false, health: "setup", secret: null })], { loadState: "loading" });
    expect(screen.getByRole("status", { name: "Loading connections" })).toBeTruthy();
    expect(screen.queryByText("Not connected")).toBeNull();
  });

  it("offline: names the problem, offers Retry, and never claims a connection is or isn't connected", async () => {
    const hydrate = vi.fn().mockResolvedValue(undefined);
    show([router(), conn({})], { loadState: "offline", hydrate });
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't reach the sidecar");
    expect(screen.queryByText("Not connected")).toBeNull();
    expect(screen.getAllByText("Can't check").length).toBeGreaterThan(1);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(hydrate).toHaveBeenCalled();
  });

  it("testing: the header button keeps its place and says it is working", () => {
    show([conn({ health: "probing", defaultModel: "gemma4:26b" })]);
    expect(screen.getAllByText("Checking connection").length).toBeGreaterThan(0);
    expect(screen.getByText("Testing the connection…")).toBeTruthy();
  });

  it("a connection that only lacks a model offers Choose a model next to Test", () => {
    show([conn({ health: "setup" })]);
    expect(screen.getByRole("button", { name: "Choose a model" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test" })).toBeTruthy();
  });

  it("a stopped local Ollama has one primary action, copy `ollama serve`, and Test again beside it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    show([conn({ health: "fault", detail: "Could not reach http://127.0.0.1:11434.", defaultModel: "gemma4:26b" })]);
    expect(screen.getAllByText("Unreachable").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Copy `ollama serve`" }));
    expect(writeText).toHaveBeenCalledWith("ollama serve");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test again" })).toBeTruthy();
  });

  it("a local Ollama whose default model is not pulled copies the pull command and warns in Models", () => {
    show([conn({ defaultModel: "llama3.2", health: "live" })]);
    expect(screen.getAllByText("Model not pulled").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Copy `ollama pull llama3.2`" })).toBeTruthy();
    expect(screen.getByText("llama3.2 isn't pulled on this machine")).toBeTruthy();
  });

  it("a rejected key: Replace key opens the key field, focused", async () => {
    show([router({ secret: sealed, health: "fault", detail: "401 unauthorized — the key was rejected." })]);
    expect(screen.getAllByText("Key rejected").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Replace key" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Paste your OpenRouter key")));
  });

  it("a connected connection has no primary action", () => {
    show([router({ secret: sealed, health: "live" })]);
    expect(screen.getAllByText("Verified").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^(Paste|Replace key|Turn on|Choose)/ })).toBeNull();
  });

  it("an agent-only connection shows the handoff and no dead buttons", () => {
    show([conn({ id: "cursor", provider: "cursor", label: "Cursor", residence: "cloud", models: [], endpoint: "https://api.cursor.com" })]);
    expect(screen.getByText("How the handoff works")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delegate a task|launch in terminal/i })).toBeNull();
    expect(screen.queryByText("Models")).toBeNull();
  });
});

describe("key", () => {
  it("saves a pasted key through the store, clears the field, and never echoes it", async () => {
    const attachSecret = vi.fn().mockResolvedValue(undefined);
    show([router({ health: "setup", enabled: false })], { attachSecret });
    const field = screen.getByLabelText("Paste your OpenRouter key") as HTMLInputElement;
    expect(field.type).toBe("password");
    await userEvent.type(field, "sk-or-supersecret");
    await userEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(attachSecret).toHaveBeenCalledWith("openrouter", "sk-or-supersecret");
    await waitFor(() => expect(field.value).toBe(""));
    expect(document.body.textContent).not.toContain("supersecret");
  });

  it("warns, without blocking the page, when the key is from another vendor", async () => {
    show([router({ health: "setup", enabled: false })]);
    await userEvent.type(screen.getByLabelText("Paste your OpenRouter key"), "sk-ant-x");
    expect(screen.getByText(/keys begin sk-or-/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save key" }).hasAttribute("disabled")).toBe(true);
  });

  it("a failed save says so in generic words and keeps the form", async () => {
    show([router({ health: "setup", enabled: false })], { attachSecret: vi.fn().mockRejectedValue(new Error("sk-or-leak")) });
    await userEvent.type(screen.getByLabelText("Paste your OpenRouter key"), "sk-or-abc");
    await userEvent.click(screen.getByRole("button", { name: "Save key" }));
    const alert = await screen.findByText(/wasn't saved/);
    expect(alert.textContent).not.toContain("leak");
  });

  it("shows a sealed key as prefix, drawn bar and tail, with no way to read it back", () => {
    show([router({ secret: sealed })]);
    expect(screen.getByText("9f3a")).toBeTruthy();
    expect(screen.getByRole("img", { name: "30 characters withheld" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();
  });

  it("does not invent a key length for a reference restored from the backend", () => {
    show([router({ secret: { ...sealed, length: 0, tail: "····" } })]);
    expect(screen.getByRole("img", { name: "Key value withheld; length unavailable" })).toBeTruthy();
  });

  it("Remove asks first, Cancel has focus, and a refused removal keeps the key and says so", async () => {
    const revokeSecret = vi.fn().mockResolvedValue(false);
    show([router({ secret: sealed })], { revokeSecret });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(revokeSecret).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove key" }));
    expect(revokeSecret).toHaveBeenCalledWith("openrouter");
    expect((await screen.findByText(/Couldn't remove the key/)).textContent).toContain("still stored");
  });

  it("Escape in the confirmation cancels and returns focus to Replace", async () => {
    show([router({ secret: sealed })]);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Remove key" })).toBeNull();
  });
});

describe("endpoint", () => {
  it("saves an edit on blur and reports it", async () => {
    const saveEndpoint = vi.fn().mockResolvedValue(true);
    show([conn({ defaultModel: "gemma4:26b" })], { saveEndpoint });
    const field = screen.getByRole("textbox", { name: "Ollama local endpoint" });
    fireEvent.change(field, { target: { value: "http://127.0.0.1:11500/v1" } });
    fireEvent.blur(field);
    expect(saveEndpoint).toHaveBeenCalledWith("ollama-local", "http://127.0.0.1:11500/v1");
    expect(await screen.findByText("Endpoint saved.")).toBeTruthy();
  });

  it("Test saves the endpoint on screen first, then probes", async () => {
    const order: string[] = [];
    const saveEndpoint = vi.fn(async () => {
      order.push("save");
      return true;
    });
    const probe = vi.fn(async () => void order.push("probe"));
    show([conn({ defaultModel: "gemma4:26b" })], { saveEndpoint, probe });
    fireEvent.change(screen.getByRole("textbox", { name: "Ollama local endpoint" }), { target: { value: "http://127.0.0.1:11500/v1" } });
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(order).toEqual(["save", "probe"]));
  });

  it("keeps the edit and says so when it could not be saved", async () => {
    show([conn({ defaultModel: "gemma4:26b" })], { saveEndpoint: vi.fn().mockResolvedValue(false) });
    const field = screen.getByRole("textbox", { name: "Ollama local endpoint" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "http://bad" } });
    fireEvent.blur(field);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't save the endpoint/);
    expect(field.value).toBe("http://bad");
  });

  it("a vendor-fixed endpoint is read-only and says who set it", () => {
    show([router()]);
    expect((screen.getByRole("textbox", { name: "OpenRouter endpoint" }) as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText("Set by the vendor.")).toBeTruthy();
  });
});

describe("models", () => {
  it("saves a chosen default and says where the list came from", async () => {
    const setDefaultModel = vi.fn().mockResolvedValue(true);
    show([conn({})], { setDefaultModel });
    expect(screen.getAllByText("No model chosen").length).toBeGreaterThan(0);
    expect(screen.getByText("Served by http://127.0.0.1:11434/v1 at the last test.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Use gemma4:26b as the default" }));
    expect(setDefaultModel).toHaveBeenCalledWith("ollama-local", "gemma4:26b");
    expect(await screen.findByText("Saved. Runs use gemma4:26b.")).toBeTruthy();
  });

  it("says so when the default could not be saved", async () => {
    show([conn({})], { setDefaultModel: vi.fn().mockResolvedValue(false) });
    await userEvent.click(screen.getByRole("button", { name: "Use gemma4:26b as the default" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't save the default model/);
  });

  it("a router with hundreds of models renders a capped, searchable slice (ADR 0015)", async () => {
    const models = Array.from({ length: 400 }, (_, i) => ({ id: `vendor-${i % 20}/model-${i}`, ctx: 0 }));
    models.push({ id: "openai/gpt-4o", ctx: 0 });
    show([router({ models, defaultModel: "openai/gpt-4o" })]);
    const list = screen.getByRole("list", { name: "OpenRouter models" });
    expect(within(list).getAllByRole("listitem").length).toBe(8);
    expect(screen.getByText(/more\. Refine the filter/)).toBeTruthy();
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter models" }), "gpt-4o");
    expect(within(screen.getByRole("list", { name: "OpenRouter models" })).getAllByRole("listitem")[0].textContent).toContain("openai/gpt-4o");
    await userEvent.clear(screen.getByRole("searchbox", { name: "Filter models" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter models" }), "zzzz");
    expect(screen.getByText("No model matches “zzzz”.")).toBeTruthy();
  });

  it("shows no route, tie-break or request preview the app never sends", () => {
    show([router()]);
    expect(screen.queryByText(/tie-break/i)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Route" })).toBeNull();
    expect(screen.getByText(/From the OHarness catalogue/)).toBeTruthy();
  });

  it("an empty local Ollama says what to run", () => {
    show([conn({ models: [], defaultModel: "" })]);
    expect(screen.getByText("ollama pull llama3.2").tagName).toBe("CODE");
  });
});

describe("activity and spend", () => {
  it("a free local connection with usage shows no unpriced warning; a cloud one with unpriced tokens does", () => {
    useUsageStore.setState({ summary: { byConnection: [{ connectionId: "ollama-local", provider: "ollama", tokensTotal: 42, unpricedTokens: 42, costComplete: true, estimatedCostUsd: 0 }], budget: { limitUsd: null, state: "unset" } } as never });
    const { unmount } = show([conn({ defaultModel: "gemma4:26b" })]);
    expect(screen.queryByText("Unpriced usage")).toBeNull();
    unmount();
    useUsageStore.setState({ summary: { byConnection: [{ connectionId: "openrouter", provider: "openrouter", tokensTotal: 10, unpricedTokens: 10, costComplete: false, estimatedCostUsd: null }], budget: { limitUsd: null, state: "unset" } } as never });
    show([router()]);
    expect(screen.getByText("Unpriced usage")).toBeTruthy();
    expect(screen.getAllByText("Cost unknown").length).toBeGreaterThan(1);
  });

  it("with no test and no usage, the rows say so instead of showing numbers", () => {
    show([router()]);
    expect(screen.getByText("Not tested yet")).toBeTruthy();
    expect(screen.getByText("No usage recorded yet.")).toBeTruthy();
  });

  it("a failed budget edit stays open for correction, and a usage failure never prints the raw error", async () => {
    vi.mocked(usageApi.setBudget).mockRejectedValue(new Error("sidecar unavailable"));
    useUsageStore.setState({ error: "sidecar unavailable" });
    show([router()]);
    expect(screen.getByText(/Usage may be out of date/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("sidecar unavailable");
    await userEvent.click(screen.getByRole("button", { name: "No budget. Set one" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Global budget in USD" }), { target: { value: "15" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't save the budget");
    expect((screen.getByRole("textbox", { name: "Global budget in USD" }) as HTMLInputElement).value).toBe("15");
  });

  it("rejects a negative budget in place", async () => {
    show([router()]);
    await userEvent.click(screen.getByRole("button", { name: "No budget. Set one" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Global budget in USD" }), { target: { value: "-1" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("zero or a positive");
  });
});

describe("language and accessibility", () => {
  it("speaks Portuguese end to end, keeping commands and ids as they are", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    show([conn({ health: "fault", detail: "Could not reach http://127.0.0.1:11434.", defaultModel: "gemma4:26b" })]);
    expect(screen.getAllByText("Inacessível").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Copiar `ollama serve`" })).toBeTruthy();
    expect(screen.getByText("Precisa de ação")).toBeTruthy();
    expect(screen.getByText("Conexão")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Endereço de Ollama local" })).toBeTruthy();
  });

  it.each(["en", "pt-BR"] as const)("has no axe violations (%s) in a healthy, a failing and an offline state", async (locale) => {
    useLocaleStore.setState({ locale });
    for (const [list, extra] of [
      [[router({ secret: sealed, health: "live" }), conn({})], {}],
      [[router({ secret: sealed, health: "fault", detail: "401 unauthorized — x" })], {}],
      [[router({ health: "setup", enabled: false })], { loadState: "offline" }],
    ] as const) {
      const { container, unmount } = show([...list], { ...extra });
      expect(await axeViolations(container)).toEqual([]);
      unmount();
    }
  });
});
