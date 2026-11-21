import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { UsageStrip, UsageWindowLine, type UsageWindowsRow } from "./UsageWindows";
import type { Connection } from "./providerStore";

const conn = (over: Partial<Connection>): Connection => ({
  id: "anthropic", provider: "anthropic", label: "Anthropic", residence: "cloud", endpoint: "",
  secret: null, health: "live", detail: "", probes: [], facts: [], models: [], defaultModel: "", enabled: true, lastProbe: "",
  ...over,
});

const unavailable: UsageWindowsRow = { cli: "claude", provider: "anthropic", available: false };

afterEach(() => {
  cleanup();
  useLocaleStore.setState({ locale: "en" });
});

describe("usage windows", () => {
  it("says usage is unavailable and never draws a 0% bar", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    render(<UsageWindowLine row={unavailable} name="Anthropic" />);
    expect(screen.getByText("Uso indisponível para esta conta")).toBeTruthy();
    expect(document.body.textContent).not.toContain("0%");
    expect(document.querySelector("meter")).toBeNull();
  });

  it("shows the 5-hour and weekly windows with the reset time", () => {
    render(
      <UsageWindowLine
        row={{ cli: "claude", provider: "anthropic", available: true, fiveHour: { usedPct: 62, resetsAt: "2026-11-21T09:20:00Z" }, weekly: { usedPct: 40 } }}
        name="Anthropic"
      />,
    );
    expect(screen.getByText("5-hour · 62%")).toBeTruthy();
    expect(screen.getByText("Week · 40%")).toBeTruthy();
    expect(screen.getByText(/back at/)).toBeTruthy();
    expect(document.querySelectorAll("meter")).toHaveLength(2);
  });

  it("hides the strip when there is no subscription", () => {
    render(<UsageStrip connections={[conn({ id: "ollama-local", provider: "ollama", residence: "local", label: "Ollama local" })]} />);
    expect(screen.queryByText("Usage is unavailable for this account")).toBeNull();
  });
});
