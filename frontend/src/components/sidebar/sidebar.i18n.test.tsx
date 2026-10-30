import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NodePalette } from "./NodePalette";
import { PropertiesPanel } from "./PropertiesPanel";
import { useCanvasStore } from "@/store/canvasStore";
import { useLocaleStore } from "@/i18n/store";

afterEach(() => act(() => useLocaleStore.getState().setLocale("en")));

describe("sidebar in pt-BR", () => {
  it("translates the block palette, keeping node names", () => {
    act(() => useLocaleStore.getState().setLocale("pt-BR"));
    render(<NodePalette />);
    expect(screen.getByText("Blocos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Adicionar Agent" }).getAttribute("title")).toContain("Ator com papel definido");
    expect(screen.getAllByText("1 de entrada · 1 de saída").length).toBeGreaterThan(0);
  });

  it("translates the empty inspector", () => {
    act(() => {
      useCanvasStore.getState().setSelectedNode(null);
      useLocaleStore.getState().setLocale("pt-BR");
    });
    render(<PropertiesPanel />);
    expect(screen.getByText("Selecione um bloco")).toBeTruthy();
  });

  it("translates a selected agent's settings, wiring and temperature", () => {
    act(() => {
      useCanvasStore.getState().addNode({ id: "agent-1", type: "agent", position: { x: 0, y: 0 }, data: { label: "Agent", temperature: 0.7, providerIds: ["x"] } } as never);
      useCanvasStore.getState().setSelectedNode("agent-1");
      useLocaleStore.getState().setLocale("pt-BR");
    });
    render(<PropertiesPanel />);
    expect(screen.getAllByText("Ligações").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Configurações").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Temperatura — 0,7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Conexões de reserva").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\{\w+\}/)).toBeNull();
  });
});
