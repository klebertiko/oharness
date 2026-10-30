import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBar } from "./StatusBar";
import { KeymapSheet } from "./KeymapSheet";
import { shellNavCommands } from "./commands";
import { useLocaleStore } from "@/i18n/store";

afterEach(() => act(() => useLocaleStore.getState().setLocale("en")));

describe("shell in pt-BR", () => {
  it("translates the status bar with plural forms", () => {
    act(() => useLocaleStore.getState().setLocale("pt-BR"));
    render(<StatusBar mode="Mock" running={false} nodeCount={3} edgeCount={1} selectedId={null} backendOk={false} />);
    expect(screen.getByText("Pronto")).toBeTruthy();
    expect(screen.getByText("3 nós · 1 conexão")).toBeTruthy();
    expect(screen.getByText("Motor offline")).toBeTruthy();
  });

  it("translates the keymap and the navigation commands", () => {
    act(() => useLocaleStore.getState().setLocale("pt-BR"));
    render(<KeymapSheet open onClose={() => {}} />);
    expect(screen.getByText("Todo atalho também está na paleta de comandos.")).toBeTruthy();
    expect(shellNavCommands()[0].label).toBe("Ir para Chats");
  });
});
