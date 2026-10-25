import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { UsageSummary } from "@/lib/usageApi";
import { Dossier } from "./Dossier";
import { useProviderStore, type Connection } from "./providerStore";
import { useUsageStore } from "./usageStore";

/**
 * 2026-09-15 — QA bounce (qa.md, Finding 1). The Usage block's "unpriced"
 * caveat (Dossier.tsx:232-240) fired on `usage.unpricedTokens > 0` alone,
 * with no `c.residence` check, even though the cost line right above it
 * (`spendStamp`, Dossier.tsx:35-43) already correctly checks residence. Net
 * effect: a genuinely free local Ollama connection showed "cost: free" and,
 * one row below, "N tokens billed at an unknown rate ... this total may
 * understate real spend" for the *same* connection — a direct
 * contradiction, since a local connection has no hidden real spend to
 * understate. There was no Dossier.test.tsx before this; these two tests
 * pin both states so it cannot regress silently again.
 */

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: "an",
    provider: "anthropic",
    label: "Anthropic",
    residence: "cloud",
    endpoint: "https://api.anthropic.com",
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

function summaryFor(
  connectionId: string,
  provider: string,
  usage: { tokensTotal: number; costUsd: number; unpricedTokens: number }
): UsageSummary {
  return {
    totalTokens: usage.tokensTotal,
    totalCostUsd: usage.costUsd,
    unpricedTokens: usage.unpricedTokens,
    budget: { limitUsd: null, spentUsd: usage.costUsd, remainingUsd: null, pct: null, state: "unset" },
    byConnection: [{ connectionId, provider, ...usage }],
    bySource: [],
  };
}

const initialProvider = useProviderStore.getState();
const initialUsage = useUsageStore.getState();

afterEach(() => {
  cleanup();
  useProviderStore.setState(initialProvider, true);
  useUsageStore.setState(initialUsage, true);
});

it("shows no contradictory unpriced caveat for a free local connection with real usage", () => {
  const local = connection({
    id: "ollama-local",
    provider: "ollama",
    label: "Ollama",
    residence: "local",
    endpoint: "http://127.0.0.1:11434/v1",
  });
  useProviderStore.setState({ connections: [local], selectedId: local.id });
  useUsageStore.setState({
    hydrated: true,
    summary: summaryFor(local.id, "ollama", { tokensTotal: 50_000, costUsd: 0, unpricedTokens: 50_000 }),
  });

  render(<Dossier />);

  // The cost line correctly reads "free" (spendStamp already checks residence) ...
  expect(screen.getAllByText("cost unknown").length).toBeGreaterThan(0);
  // ... and nothing beside it claims real spend might be understated.
  expect(screen.queryByText(/may understate real spend/i)).toBeNull();
});

it("still warns about unpriced tokens for a cloud connection that genuinely has them", () => {
  const cloud = connection({
    id: "anthropic",
    provider: "anthropic",
    label: "Anthropic",
    residence: "cloud",
  });
  useProviderStore.setState({ connections: [cloud], selectedId: cloud.id });
  useUsageStore.setState({
    hydrated: true,
    summary: summaryFor(cloud.id, "anthropic", { tokensTotal: 10_000, costUsd: 1.5, unpricedTokens: 4_000 }),
  });

  render(<Dossier />);

  expect(screen.getByText(/may understate real spend/i)).toBeTruthy();
});

it("labels local usage without claiming free and discloses unavailable measurement provenance", () => {
  const c = connection({ id: "local", provider: "ollama", residence: "local" });
  useProviderStore.setState({ connections: [c], selectedId: c.id });
  useUsageStore.setState({ hydrated: true, summary: summaryFor(c.id, c.provider, { tokensTotal: 42, costUsd: 0, unpricedTokens: 42 }) });
  render(<Dossier />);
  // The spend fact must not claim "free" (billing model "free" is a different fact).
  const spent = screen.getByText("Spent", { selector: "dt" }).parentElement!;
  expect(within(spent).queryByText(/free/)).toBeNull();
  expect(screen.getAllByText("cost unknown").length).toBeGreaterThan(0);
  expect(screen.getByText(/Measured and estimated tokens are not separated/i)).toBeTruthy();
});

it("does not show a partial priced subtotal as the known total", () => {
  const c = connection({});
  useProviderStore.setState({ connections: [c], selectedId: c.id });
  const summary = summaryFor(c.id, c.provider, { tokensTotal: 42, costUsd: 1.5, unpricedTokens: 12 });
  Object.assign(summary.byConnection[0], { costComplete: false, estimatedCostUsd: null });
  useUsageStore.setState({ hydrated: true, summary });
  render(<Dossier />);
  expect(screen.getByText("cost unknown", { selector: "dd" })).toBeTruthy();
});

it("leads a not-ready connection with the credential block, above the summary prose", () => {
  const c = connection({ provider: "openrouter", enabled: false, health: "setup", secret: null });
  useProviderStore.setState({ connections: [c], selectedId: c.id });
  useUsageStore.setState({ hydrated: true });
  render(<Dossier />);
  const credentialHeading = screen.getByRole("heading", { name: "Credential" });
  const summary = screen.getByText(/One key, many vendors/i);
  // DOM order: the fix-it action comes first when the connection isn't ready.
  expect(credentialHeading.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("moves the credential block below the summary once the connection is ready", () => {
  const c = connection({ provider: "openrouter", enabled: true, health: "live", secret: null, defaultModel: "deepseek/deepseek-v4" });
  useProviderStore.setState({ connections: [c], selectedId: c.id });
  useUsageStore.setState({ hydrated: true });
  render(<Dossier />);
  const credentialHeading = screen.getByRole("heading", { name: "Credential" });
  const summary = screen.getByText(/One key, many vendors/i);
  expect(summary.compareDocumentPosition(credentialHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("uses the same status word the chat combo uses for the header badge", () => {
  const c = connection({ enabled: false, health: "setup" });
  useProviderStore.setState({ connections: [c], selectedId: c.id });
  useUsageStore.setState({ hydrated: true });
  render(<Dossier />);
  expect(screen.getByText("Not connected")).toBeTruthy();
});

it("does not invent a key length for a credential reference restored from backend", () => {
  const c = connection({ provider: "openrouter", secret: { service: "oharness/openrouter", prefix: "", tail: "", length: 0, savedAt: "", vault: "backend" } });
  useProviderStore.setState({ connections: [c], selectedId: c.id });
  useUsageStore.setState({ hydrated: true });
  render(<Dossier />);
  expect(screen.queryByText("0 characters")).toBeNull();
  expect(screen.getByLabelText("Credential value withheld; length unavailable")).toBeTruthy();
});
