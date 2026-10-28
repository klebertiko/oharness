import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Dossier } from "./Dossier";
import { useProviderStore, type Connection } from "./providerStore";
import { useUsageStore } from "./usageStore";

/* providers-recovery: the dossier only shows settings a run actually uses,
   saves what it lets you edit, and says honestly when a save fails.
   F3 endpoint, F5 default model, F6 route fiction, F10 remove key, F11 dead buttons. */

function connection(over: Partial<Connection>): Connection {
  return {
    id: "ollama-local", provider: "ollama", label: "Ollama local", residence: "local",
    endpoint: "http://127.0.0.1:11434/v1", secret: null, health: "live", detail: "", probes: [], facts: [],
    models: [{ id: "gemma4:26b", ctx: 0 }, { id: "nomic-embed-text:latest", ctx: 0 }], modelsFromEndpoint: true,
    defaultModel: "", enabled: true, lastProbe: "", ...over,
  };
}

const initialProvider = useProviderStore.getState();
const initialUsage = useUsageStore.getState();

function show(c: Connection, actions: Record<string, unknown> = {}) {
  useProviderStore.setState({ connections: [c], selectedId: c.id, ...actions });
  render(<Dossier />);
}

beforeEach(() => {
  useUsageStore.setState({ hydrate: async () => undefined } as never);
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initialProvider, true);
  useUsageStore.setState(initialUsage, true);
});

it("states that a model is missing and saves the chosen default model (F5)", async () => {
  const user = userEvent.setup();
  const setDefaultModel = vi.fn().mockResolvedValue(true);
  show(connection({}), { setDefaultModel });
  expect(screen.getAllByText("No model chosen").length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Default model: None chosen" }));
  await user.click(screen.getByRole("option", { name: /gemma4:26b/ }));
  expect(setDefaultModel).toHaveBeenCalledWith("ollama-local", "gemma4:26b");
  expect(await screen.findByText(/saved/i)).toBeTruthy();
});

it("says so when the default model could not be saved", async () => {
  const user = userEvent.setup();
  show(connection({}), { setDefaultModel: vi.fn().mockResolvedValue(false) });
  await user.click(screen.getByRole("button", { name: "Default model: None chosen" }));
  await user.click(screen.getByRole("option", { name: /gemma4:26b/ }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/couldn.t save/i);
});

it("lists the models the endpoint served, and says where the list came from (F4)", () => {
  show(connection({ defaultModel: "gemma4:26b" }));
  expect(screen.getByText(/served by http:\/\/127\.0\.0\.1:11434\/v1/i)).toBeTruthy();
  expect(screen.getByText("nomic-embed-text:latest")).toBeTruthy();
  expect(screen.queryByText(/allowed/i)).toBeNull();
});

it("saves an edited endpoint on blur and reports the outcome (F3)", async () => {
  const saveEndpoint = vi.fn().mockResolvedValue(true);
  show(connection({}), { saveEndpoint });
  const field = screen.getByRole("textbox", { name: "Ollama local endpoint" });
  fireEvent.change(field, { target: { value: "http://127.0.0.1:11500/v1" } });
  fireEvent.blur(field);
  expect(saveEndpoint).toHaveBeenCalledWith("ollama-local", "http://127.0.0.1:11500/v1");
  expect(await screen.findByText("Endpoint saved.")).toBeTruthy();
});

it("tests against the endpoint on screen: an unsaved edit is saved before the probe runs", async () => {
  const user = userEvent.setup();
  const order: string[] = [];
  const saveEndpoint = vi.fn(async () => { order.push("save"); return true; });
  const probe = vi.fn(async () => { order.push("probe"); });
  show(connection({ defaultModel: "gemma4:26b" }), { saveEndpoint, probe });
  fireEvent.change(screen.getByRole("textbox", { name: "Ollama local endpoint" }), { target: { value: "http://127.0.0.1:11500/v1" } });
  await user.click(screen.getByRole("button", { name: /^test$/i }));
  await waitFor(() => expect(order).toEqual(["save", "probe"]));
});

it("keeps the edit and says so when the endpoint could not be saved", async () => {
  show(connection({}), { saveEndpoint: vi.fn().mockResolvedValue(false) });
  const field = screen.getByRole("textbox", { name: "Ollama local endpoint" });
  fireEvent.change(field, { target: { value: "http://bad" } });
  fireEvent.blur(field);
  expect((await screen.findByRole("alert")).textContent).toMatch(/couldn.t save the endpoint/i);
  expect((field as HTMLInputElement).value).toBe("http://bad");
});

it("shows no route, tie-break or request preview the app never sends (F6)", () => {
  show(connection({
    id: "openrouter", provider: "openrouter", label: "OpenRouter", residence: "cloud", endpoint: "https://openrouter.ai/api/v1",
    models: [{ id: "deepseek/deepseek-v4", ctx: 128000, via: "DeepSeek" }], modelsFromEndpoint: false,
  }));
  expect(screen.queryByText(/tie-break/i)).toBeNull();
  expect(screen.queryByText(/chat\/completions/)).toBeNull();
  expect(screen.queryByRole("heading", { name: "Route" })).toBeNull();
  expect(screen.getByText(/from the oharness catalog/i)).toBeTruthy();
});

it("renders no dead buttons on an agent-only connection (F11)", () => {
  show(connection({ id: "cursor", provider: "cursor", label: "Cursor", residence: "cloud", models: [], endpoint: "https://api.cursor.com" }));
  expect(screen.queryByRole("button", { name: /delegate a task/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /launch in terminal/i })).toBeNull();
});

it("Remove key that the sidecar refused keeps the key and says so (F10)", async () => {
  const user = userEvent.setup();
  const revokeSecret = vi.fn().mockResolvedValue(false);
  show(connection({
    id: "openrouter", provider: "openrouter", label: "OpenRouter", residence: "cloud", endpoint: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-v4",
    secret: { service: "oharness/openrouter", prefix: "sk-or-", tail: "9f3a", length: 40, vault: "backend", savedAt: "" },
  }), { revokeSecret });
  await user.click(screen.getByRole("button", { name: /remove/i }));
  expect(revokeSecret).toHaveBeenCalledWith("openrouter");
  expect((await screen.findByRole("alert")).textContent).toMatch(/couldn.t remove the key/i);
});

it("a connection that only lacks a model still offers Test next to Choose a model", () => {
  show(connection({ health: "setup" }));
  expect(screen.getByRole("button", { name: "Choose a model" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^test$/i })).toBeTruthy();
});

it("a stopped local Ollama offers one primary action - copy `ollama serve` - and a Test again beside it", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  show(connection({ health: "fault", detail: "Could not reach http://127.0.0.1:11434." }));
  expect(screen.getAllByText("Unreachable").length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Copy `ollama serve`" }));
  expect(writeText).toHaveBeenCalledWith("ollama serve");
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Test again" })).toBeTruthy();
});

it("a rejected key says so and points at the key field", () => {
  show(connection({ provider: "openrouter", label: "OpenRouter", residence: "cloud", health: "fault", detail: "401 unauthorized — the key was rejected or has been revoked." }));
  expect(screen.getAllByText("Key rejected").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Replace key" })).toBeTruthy();
});
