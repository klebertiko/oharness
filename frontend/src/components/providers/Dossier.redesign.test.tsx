import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Dossier } from "./Dossier";
import { useProviderStore, type Connection } from "./providerStore";
import { useUsageStore } from "./usageStore";

/**
 * 2026-10-04 Providers redesign (hallmark redesign, design.md § Curated
 * Library + § Provider stance). Pins the parts of the new hierarchy that
 * carry behaviour: one obvious primary action per not-ready connection, a
 * facts sheet that is a real definition list (so it can wrap instead of
 * overlapping), a provider switcher for windows too narrow for the list,
 * and no mascot on this screen.
 */

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: "or", provider: "openrouter", label: "OpenRouter", residence: "cloud",
    endpoint: "https://openrouter.ai/api/v1", secret: null, health: "setup", detail: "",
    probes: [], facts: [], models: [], defaultModel: "",
    enabled: false, lastProbe: "",
    ...overrides,
  };
}

const initialProvider = useProviderStore.getState();
const initialUsage = useUsageStore.getState();
afterEach(() => {
  cleanup();
  useProviderStore.setState(initialProvider, true);
  useUsageStore.setState(initialUsage, true);
});

const header = () => screen.getByRole("heading", { level: 1 }).closest("header")!;

function mount(connections: Connection[], selectedId = connections[0]?.id ?? "") {
  useUsageStore.setState({ hydrated: true, hydrate: async () => {} });
  useProviderStore.setState({ connections, selectedId });
  return render(<Dossier />);
}

it("a key-less cloud connection leads with one primary action that focuses the key field", () => {
  mount([connection({})]);
  const primary = within(header()).getByRole("button", { name: "Paste an OpenRouter key" });
  fireEvent.click(primary);
  expect(document.activeElement).toBe(screen.getByLabelText(/paste your openrouter key/i));
});

it("a keyless local connection that is off offers Turn on, which enables then tests", async () => {
  const toggleEnabled = vi.fn(async () => {});
  const probe = vi.fn(async () => {});
  useProviderStore.setState({ toggleEnabled, probe });
  mount([connection({ id: "ol", provider: "ollama", label: "Ollama local", residence: "local" })]);
  fireEvent.click(within(header()).getByRole("button", { name: "Turn on" }));
  await vi.waitFor(() => expect(probe).toHaveBeenCalledWith("ol"));
  expect(toggleEnabled).toHaveBeenCalledWith("ol");
});

it("a ready connection has no setup action, only Test and Turn off", () => {
  mount([connection({ enabled: true, health: "live", defaultModel: "deepseek/deepseek-v4", secret: { prefix: "sk-or-", tail: "abcd", length: 40, vault: "memory", service: "oharness/or", savedAt: "" } as Connection["secret"] })]);
  expect(within(header()).queryByRole("button", { name: /paste|turn on/i })).toBeNull();
  expect(within(header()).getByRole("button", { name: "Test" })).toBeTruthy();
  expect(within(header()).getByRole("button", { name: "Turn off" })).toBeTruthy();
});

it("states the connection facts as a sentence-case definition list", () => {
  mount([connection({})]);
  for (const term of ["Runs on", "Answers to", "Billed as", "Reachability", "Spent"]) {
    expect(screen.getByText(term, { selector: "dt" })).toBeTruthy();
  }
});

it("offers a labelled provider switcher, so a narrow window without the list can still change provider", () => {
  mount([connection({}), connection({ id: "an", provider: "anthropic", label: "Anthropic" })]);
  // The shared Combobox (providers-recovery F9), not a native select.
  fireEvent.click(screen.getByRole("button", { name: /^Provider:/ }));
  fireEvent.click(screen.getByRole("option", { name: /^Anthropic/ }));
  expect(useProviderStore.getState().selectedId).toBe("an");
});

it("shows no mascot when nothing is selected — Providers is a spec sheet", () => {
  const { container } = mount([connection({})], "missing");
  expect(screen.queryByLabelText(/nilo/i)).toBeNull();
  expect(screen.getByText(/pick a provider/i)).toBeTruthy();
  expect(container.querySelector(".oh-nilo")).toBeNull();
});
