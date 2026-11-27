import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { describe, expect, it } from "vitest";
import Catalogue from "./page";

const PRIMITIVES = [
  "Button",
  "Icon button",
  "Input and textarea",
  "Select, checkbox and switch",
  "Combobox, menu, tooltip and popover",
  "Tabs, segmented and keys",
  "Dialog and sheet",
  "Notice, toast, empty and error",
  "Skeleton, badge and status",
  "List row",
  "Transcript size",
  "Float",
  "Inset",
  "Dock",
];

describe("design system catalogue", () => {
  it("shows every primitive", () => {
    render(<Catalogue />);
    for (const name of PRIMITIVES) expect(screen.getByRole("heading", { name })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "On" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Mixed" }).getAttribute("aria-checked")).toBe("mixed");
    expect(screen.getAllByText("ok").length).toBeGreaterThan(0);
  });

  it("speaks the app language: no fixed English copy in pt-BR", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    render(<Catalogue />);
    expect(screen.getByRole("heading", { name: "Botão" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ações" })).toBeTruthy();
    expect(screen.getByText("Conversa 15px")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

afterEach(() => {
  cleanup();
  useLocaleStore.setState({ locale: "en" });
});
