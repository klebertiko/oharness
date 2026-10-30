import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ValidateDock } from "./ValidateDock";
import { Toolbar } from "@/components/toolbar/Toolbar";
import { formatRelativeTime } from "@/lib/time";
import { useLocaleStore } from "@/i18n/store";

afterEach(() => act(() => useLocaleStore.getState().setLocale("en")));

describe("studio in pt-BR", () => {
  it("translates the bundle dock and the run controls", () => {
    act(() => useLocaleStore.getState().setLocale("pt-BR"));
    render(<><ValidateDock /><Toolbar onRun={() => {}} onStop={() => {}} /></>);
    expect(screen.getByRole("button", { name: "Validar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Importar .ohm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeTruthy();
  });

  it("formats relative time per language", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(iso)).toBe("5m");
    act(() => useLocaleStore.getState().setLocale("pt-BR"));
    expect(formatRelativeTime(iso)).toBe("5 min");
  });
});
