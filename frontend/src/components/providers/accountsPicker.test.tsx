import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { FallbackNotice } from "./FallbackNotice";
import { ModelDirectory } from "./ModelDirectory";
import { PreferenceOrder } from "./PreferenceOrder";
import { movePreference, renameAccount } from "./preference";
import { pickByIntent, rememberChoice, type ChoiceModel, type ModelChoice } from "./modelChoice";

const models: ChoiceModel[] = [
  { id: "slow", connectionId: "a", connectionLabel: "Pessoal", available: true, price: [15, 75], efforts: ["low", "high"] },
  { id: "fast", connectionId: "b", connectionLabel: "Empresa", available: true, price: [1, 5] },
  { id: "gone", connectionId: "c", connectionLabel: "Empresa", available: false, reason: "Needs a sign-in" },
];

afterEach(() => {
  cleanup();
  useLocaleStore.setState({ locale: "en" });
});

describe("preference order", () => {
  it("moves an account and keeps a trimmed label", () => {
    expect(movePreference(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(renameAccount({ a: "Pessoal" }, "a", "  Casa  ")).toEqual({ a: "Casa" });
    expect(renameAccount({ a: "Pessoal" }, "a", "   ")).toEqual({ a: "Pessoal" });
  });

  it("reorders from the buttons", () => {
    const ids = ["a", "b"];
    const seen: string[][] = [];
    render(<PreferenceOrder ids={ids} labels={{ a: "Pessoal", b: "Empresa" }} onChange={(next) => seen.push(next)} onRename={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Empresa up" }));
    expect(seen.at(-1)).toEqual(["b", "a"]);
  });
});

describe("model directory", () => {
  it("picks by intent, keeps five recent combinations, and disables a missing model", () => {
    expect(pickByIntent(models, "cheapest")?.id).toBe("fast");
    expect(pickByIntent(models, "best")?.id).toBe("slow");
    let recent: ModelChoice[] = [];
    for (let n = 0; n < 6; n += 1) recent = rememberChoice(recent, { connectionId: "a", model: `m${n}`, effort: null });
    expect(recent).toHaveLength(5);
    expect(recent[0].model).toBe("m5");

    const onConnect = viConnect();
    render(
      <ModelDirectory
        models={models}
        value={{ connectionId: "a", model: "slow", effort: "low" }}
        recent={[{ connectionId: "b", model: "fast", effort: null }]}
        onChange={() => undefined}
        onConnect={onConnect.fn}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    const missing = screen.getByRole("button", { name: "gone" });
    expect(missing).toHaveProperty("disabled", true);
    expect(screen.getByText("Needs a sign-in")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect.id).toBe("c");
    expect(screen.getByRole("group", { name: "Effort" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "fast" }).length).toBeGreaterThan(0);
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
