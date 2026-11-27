import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { FallbackNotice } from "./FallbackNotice";
import { PreferenceOrder } from "./PreferenceOrder";
import { movePreference } from "./preference";
import { cheapestModel, rememberChoice, type ModelChoice } from "./modelChoice";
import type { Connection } from "./providerStore";

afterEach(() => {
  cleanup();
  useLocaleStore.setState({ locale: "en" });
});

describe("preference order", () => {
  it("moves an account", () => {
    expect(movePreference(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(movePreference(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("reorders from the buttons", () => {
    const ids = ["a", "b"];
    const seen: string[][] = [];
    render(<PreferenceOrder ids={ids} labels={{ a: "Pessoal", b: "Empresa" }} onChange={(next) => seen.push(next)} onRename={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Empresa up" }));
    expect(seen.at(-1)).toEqual(["b", "a"]);
  });
});

describe("model choice", () => {
  const priced = (id: string, provider: Connection["provider"], models: Connection["models"]): Connection => ({
    id, provider, label: id, residence: "cloud", endpoint: "", secret: null, health: "live", detail: "", probes: [], facts: [],
    models, defaultModel: "", enabled: true, lastProbe: "",
  });

  it("keeps five recent combinations, newest first, without repeats", () => {
    let recent: ModelChoice[] = [];
    for (let n = 0; n < 6; n += 1) recent = rememberChoice(recent, { connectionId: "a", model: `m${n}` });
    expect(recent).toHaveLength(5);
    expect(recent[0].model).toBe("m5");
    recent = rememberChoice(recent, { connectionId: "a", model: "m3" });
    expect(recent.map((r) => r.model)).toEqual(["m3", "m5", "m4", "m2", "m1"]);
  });

  it("compares list prices of metered accounts only", () => {
    const sub = priced("sub", "anthropic", [{ id: "tiny", ctx: 0, price: [0.01, 0.02] }]);
    const key = priced("key", "openrouter", [{ id: "big", ctx: 0, price: [15, 75] }, { id: "small", ctx: 0, price: [0.28, 1.1] }]);
    expect(cheapestModel([sub, key])?.model).toBe("small");
    expect(cheapestModel([sub])).toBeNull();
  });
});

describe("fallback notice", () => {
  it("says which account answered and offers a return", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    const back = viConnect();
    render(<FallbackNotice from="Pessoal" to="Empresa" reason="atingiu o limite" onReturn={() => { back.id = "back"; }} />);
    expect(screen.getByText("Respondido por Empresa porque Pessoal atingiu o limite")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar para Pessoal" }));
    expect(back.id).toBe("back");
  });
});

function viConnect(): { fn: (id: string) => void; id: string } {
  const box = { id: "" };
  return { box, fn: (id: string) => { box.id = id; }, get id() { return box.id; }, set id(value: string) { box.id = value; } } as { fn: (id: string) => void; id: string };
}
