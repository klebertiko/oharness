import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { axeViolations } from "@/test/axe";
import { MemoryProposalChip } from "./MemoryProposalChip";
import { MemoryScreen } from "./MemoryScreen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.dataset.theme = "dark";
});

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

it("lists what is kept and forgets one item", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "DELETE" && url.includes("/nilo/memory/")) return new Response(null, { status: 204 });
    return json([{ id: "1", kind: "rule", scope: "global", text: "frases curtas", origin: "user", status: "active", pinned: false, source_thread_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }]);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryScreen />);
  expect(await screen.findByDisplayValue("frases curtas")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Forget" }));
  expect(fetchMock).toHaveBeenCalled();
});

it("the chip asks before anything is kept", async () => {
  const remember = vi.fn();
  const dismiss = vi.fn();
  render(<MemoryProposalChip text="responda em pt-BR" onRemember={remember} onDismiss={dismiss} />);
  await userEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(dismiss).toHaveBeenCalledOnce();
  expect(remember).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Remember" }));
  expect(remember).toHaveBeenCalledOnce();
});

it("has no serious axe violations in either theme", async () => {
  vi.stubGlobal("fetch", vi.fn(() => json([])));
  for (const theme of ["dark", "light"] as const) {
    document.documentElement.dataset.theme = theme;
    const view = render(<MemoryScreen />);
    expect(await axeViolations(view.container)).toEqual([]);
    cleanup();
  }
  document.documentElement.dataset.theme = "dark";
  const chip = render(<MemoryProposalChip text="uma regra" onRemember={() => undefined} onDismiss={() => undefined} />);
  expect(await axeViolations(chip.container)).toEqual([]);
});
