import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { UsageLimitBanner } from "./UsageLimitBanner";
import { formatResetLocal } from "./usageLimit";

const RESET = "2026-11-21T09:20:00Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-21T09:00:00Z"));
  useLocaleStore.setState({ locale: "en" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useLocaleStore.setState({ locale: "en" });
});

function show(over: Partial<Parameters<typeof UsageLimitBanner>[0]> = {}) {
  const onRelease = vi.fn();
  const onHoldDraft = vi.fn();
  const onUseAccount = vi.fn();
  const onUseApiKey = vi.fn();
  render(
    <UsageLimitBanner
      resetAt={RESET}
      draft="hello from the composer"
      accounts={[{ id: "other", label: "Work" }]}
      onHoldDraft={onHoldDraft}
      onUseAccount={onUseAccount}
      onUseApiKey={onUseApiKey}
      onRelease={onRelease}
      {...over}
    />,
  );
  return { onRelease, onHoldDraft, onUseAccount, onUseApiKey };
}

describe("usage limit banner", () => {
  it("names the local reset time and the three choices", () => {
    show();
    const time = formatResetLocal(RESET, "en");
    expect(screen.getByRole("alert").textContent).toContain(`back at ${time}`);
    expect(screen.getByRole("button", { name: "Wait and send when it frees up" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use another account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use an API key" })).toBeTruthy();
  });

  it("does not take the draft when no reset time is known, since nothing would send it", () => {
    const { onHoldDraft } = show({ resetAt: null });
    const hold = screen.getByRole("button", { name: "Wait and send when it frees up" }) as HTMLButtonElement;
    expect(hold.disabled).toBe(true);
    fireEvent.click(hold);
    expect(onHoldDraft).not.toHaveBeenCalled();
  });

  it("holds the draft and sends it when the window opens", () => {
    const { onRelease, onHoldDraft } = show();
    fireEvent.click(screen.getByRole("button", { name: "Wait and send when it frees up" }));
    expect(onHoldDraft).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("Held until");
    expect(onRelease).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(20 * 60 * 1000); });
    expect(onRelease).toHaveBeenCalledWith("hello from the composer");
    expect(document.body.textContent).not.toContain("hello from the composer");
  });

  it("does not send after the banner goes away", () => {
    const { onRelease, unmount } = (() => {
      const shown = show();
      return { ...shown, unmount: () => cleanup() };
    })();
    fireEvent.click(screen.getByRole("button", { name: "Wait and send when it frees up" }));
    unmount();
    act(() => { vi.advanceTimersByTime(20 * 60 * 1000); });
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("lists ready accounts and offers an API key", () => {
    const { onUseAccount, onUseApiKey } = show();
    fireEvent.click(screen.getByRole("button", { name: "Use another account" }));
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(onUseAccount).toHaveBeenCalledWith("other");
    fireEvent.click(screen.getByRole("button", { name: "Use an API key" }));
    expect(onUseApiKey).toHaveBeenCalledOnce();
  });

  it("says so when no other account is ready", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    show({ accounts: [], draft: "olá" });
    fireEvent.click(screen.getByRole("button", { name: "Usar outra conta" }));
    expect(screen.getByText("Nenhuma outra conta está pronta")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Limite da assinatura atingido");
  });
});
