import { afterEach, describe, expect, it } from "vitest";
import { FAULT_CLASSES, type ProviderFaultClass } from "@/components/agent/chatProvider";
import { en } from "@/i18n/messages.en";
import { ptBR } from "@/i18n/messages.pt-BR";
import { useLocaleStore } from "@/i18n/store";
import { translate } from "@/i18n/translate";
import { missingProviderAction } from "./composerAction";
import { needsActionDetail, nextStep } from "./nextStep";
import type { Connection } from "./providerStore";
import { ACTION_TEXT, EMPTY_STATE_IDS, EMPTY_TABLE, STATE_TABLE } from "./stateTable";
import { viewOf } from "./view";

/* R-PRV-21: one table of (state, text, action) feeds the list row, the dossier, the combo and the composer. */

const conn = (over: Partial<Connection>): Connection =>
  ({
    id: "an", provider: "anthropic", label: "Anthropic", residence: "cloud", endpoint: "", secret: null, health: "setup",
    detail: "", probes: [], facts: [], models: [], defaultModel: "", enabled: true, lastProbe: "", ...over,
  }) as Connection;

// A CLI that is missing or signed out is probed "setup" and still off; every other failure faults the connection.
const failing = (failure: ProviderFaultClass) =>
  failure === "cli-signin" || failure === "cli-missing" ? conn({ failure, health: "setup", enabled: false }) : conn({ failure, health: "fault" });

afterEach(() => useLocaleStore.setState({ locale: "en" }));

describe("the state table is exhaustive", () => {
  it("has a row for every failure class, including the CLI timeout and the generic CLI error", () => {
    expect(Object.keys(STATE_TABLE).sort()).toEqual([...FAULT_CLASSES].sort());
    expect(FAULT_CLASSES).toEqual(expect.arrayContaining(["cli-timeout", "cli-error", "cli-signin", "cli-missing"]));
  });

  it("has a row for the empty states: nothing connected, nothing picked, agent-only", () => {
    expect([...EMPTY_STATE_IDS].sort()).toEqual(["agent-only", "no-connection", "open-providers", "pick-provider"]);
    expect(Object.keys(EMPTY_TABLE).sort()).toEqual([...EMPTY_STATE_IDS].sort());
  });

  it("every row names an action, and every text key exists in en and pt-BR", () => {
    const keys = [
      ...Object.values(STATE_TABLE).flatMap((r) => [r.status]),
      ...Object.values(EMPTY_TABLE).map((r) => r.text),
      ...Object.values(ACTION_TEXT).flatMap((r) => [r.label, r.hint]),
    ];
    for (const row of [...Object.values(STATE_TABLE), ...Object.values(EMPTY_TABLE)]) {
      expect(row.action in ACTION_TEXT || row.action === "connect").toBe(true);
    }
    for (const k of keys) {
      expect((en as Record<string, string>)[k]?.trim(), `en ${k}`).toBeTruthy();
      expect((ptBR as Record<string, string>)[k]?.trim(), `pt-BR ${k}`).toBeTruthy();
    }
  });
});

describe.each(["en", "pt-BR"] as const)("the four places read the same table (%s)", (locale) => {
  const t = (key: keyof typeof en, vars?: Record<string, string>) => translate(locale, key, vars);
  const setup = () => useLocaleStore.setState({ locale });

  it.each(FAULT_CLASSES)("%s: list row, dossier, combo and composer show the same status and action", (cls) => {
    setup();
    const c = failing(cls);
    const step = nextStep(c);
    expect(step, "a failure always has a next step").not.toBeNull();
    const status = t(STATE_TABLE[cls].status);
    // list row and dossier header
    expect(viewOf(c).status).toBe(status);
    expect(viewOf(c).step?.label).toBe(step?.label);
    // combo "Needs action" row
    expect(needsActionDetail(c, step!)).toBe(`${status} · ${step!.label}`);
    // composer call to action
    const action = missingProviderAction([c], null);
    expect(action?.text.startsWith(step!.label)).toBe(true);
    expect(action?.id).toBe("an");
  });
});

describe("the empty states", () => {
  it.each(["en", "pt-BR"] as const)("the composer says it from the table (%s)", (locale) => {
    useLocaleStore.setState({ locale });
    const t = (k: keyof typeof en) => translate(locale, k);
    expect(missingProviderAction([], null)?.text).toBe(t(EMPTY_TABLE["no-connection"].text));
    expect(missingProviderAction([conn({})], "gone")?.text).toBe(t(EMPTY_TABLE["pick-provider"].text));
    const cursor = conn({ id: "cu", provider: "cursor", label: "Cursor", enabled: true, health: "live" });
    expect(missingProviderAction([cursor], "cu")?.text).toBe(t(EMPTY_TABLE["agent-only"].text));
  });
});
