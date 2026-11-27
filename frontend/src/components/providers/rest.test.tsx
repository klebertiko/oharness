import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { visibleFact } from "./accountFacts";
import { FirstAccountCard, hasReadyAccount } from "./FirstAccountCard";
import { shouldProbe, testedAgo } from "./health";
import type { Connection } from "./providerStore";

const conn = (over: Partial<Connection>): Connection => ({
  id: "anthropic", provider: "anthropic", label: "Anthropic", residence: "cloud", endpoint: "",
  secret: null, health: "setup", detail: "", probes: [], facts: [], models: [], defaultModel: "", enabled: false, lastProbe: "",
  ...over,
});

afterEach(() => {
  cleanup();
  useLocaleStore.setState({ locale: "en" });
});

describe("plan and health", () => {
  it("shows an enumerated plan and drops an address", () => {
    expect(visibleFact("plan", "Max")).toBe("Max");
    expect(visibleFact("plan", "canary-person@example.test")).toBeNull();
    expect(visibleFact("account", "canary-person@example.test")).toBeNull();
  });

  it("probes at most once a minute and says how long ago", () => {
    expect(shouldProbe(undefined, 1_000)).toBe(true);
    expect(shouldProbe(0, 59_000)).toBe(false);
    expect(shouldProbe(0, 60_000)).toBe(true);
    expect(testedAgo(new Date(0).toISOString(), 3 * 60_000)).toEqual({ unit: "min", n: 3 });
  });
});

describe("first account", () => {
  it("shows one card until an account is ready, in Portuguese", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    const chosen: string[] = [];
    render(<FirstAccountCard connections={[conn({}), conn({ id: "ollama-local", provider: "ollama", residence: "local", label: "Local" })]} onChoose={(id) => chosen.push(id)} />);
    expect(screen.getByText("Conecte sua primeira conta")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Modelo local" }));
    expect(chosen).toEqual(["ollama-local"]);
    expect(hasReadyAccount([conn({ health: "live", enabled: true })])).toBe(true);
  });

});
