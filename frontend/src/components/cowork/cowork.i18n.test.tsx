import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoworkPanel } from "./CoworkPanel";
import { modelDetail } from "@/components/providers/ModelPicker";
import { useLocaleStore } from "@/i18n/store";

vi.mock("@/lib/coworkApi", () => ({ coworkApi: { list: async () => ({ projects: [] }), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }));

afterEach(() => act(() => useLocaleStore.getState().setLocale("en")));

describe("cowork and pickers in pt-BR", () => {
  it("translates the cowork panel", async () => {
    act(() => useLocaleStore.getState().setLocale("pt-BR"));
    render(<CoworkPanel />);
    expect(await screen.findByText("Nenhum projeto do Cowork ainda.")).toBeTruthy();
    expect(screen.getByPlaceholderText("Nome do projeto")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Criar projeto" })).toBeTruthy();
  });

  it("phrases a model's context window per language", () => {
    const model = { id: "m", via: "", ctx: 128000, size: "", price: null } as never;
    expect(modelDetail(model)).toBe("128k context");
    act(() => useLocaleStore.getState().setLocale("pt-BR"));
    expect(modelDetail(model)).toBe("128k de contexto");
  });
});
