import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { en } from "./messages.en";
import { ptBR } from "./messages.pt-BR";
import { detectLocale, LOCALE_KEY } from "./locale";
import { useLocaleStore, tr } from "./store";
import { formatDate, formatNumber, translate, translatePlural } from "./translate";

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("catalogs", () => {
  it("define exactly the same keys, none empty", () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[k].trim(), k).not.toBe("");
      expect(ptBR[k].trim(), k).not.toBe("");
    }
  });

  it("keep the same placeholders in every language, except where a language drops one on purpose", () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      const [a, b] = [holes(en[k]), holes(ptBR[k])];
      expect(b.every((h) => a.includes(h)), `${k}: ${b} not in ${a}`).toBe(true);
    }
  });

  it("never translate a command: backticked text is identical", () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      const code = (s: string) => [...s.matchAll(/`[^`]+`/g)].map((m) => m[0]);
      expect(code(ptBR[k]), k).toEqual(code(en[k]));
    }
  });
});

describe("translate", () => {
  it("fills {name} and leaves unknown holes visible rather than blank", () => {
    expect(translate("en", "step.copyPull", { id: "llama3.2" })).toBe("Copy `ollama pull llama3.2`");
    expect(translate("pt-BR", "step.paste", { vendor: "OpenRouter", article: "an" })).toBe("Colar a chave OpenRouter");
    expect(translate("en", "step.copyPull")).toBe("Copy `ollama pull {id}`");
  });
});

describe("detectLocale", () => {
  it("prefers a saved choice, then the first browser language, then English", () => {
    expect(detectLocale("en", ["pt-BR"])).toBe("en");
    expect(detectLocale(null, ["pt-PT", "en-US"])).toBe("pt-BR");
    expect(detectLocale(null, ["fr-FR", "pt-BR"])).toBe("pt-BR");
    expect(detectLocale(null, ["en-GB"])).toBe("en");
    expect(detectLocale("xx", [])).toBe("en");
  });
});

describe("locale store", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => useLocaleStore.setState({ locale: "en" }));

  it("saves the choice, sets <html lang> and drives tr()", () => {
    useLocaleStore.getState().setLocale("pt-BR");
    expect(localStorage.getItem(LOCALE_KEY)).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(tr("status.notConnected")).toBe("Não conectado");
    useLocaleStore.getState().setLocale("en");
    expect(tr("status.notConnected")).toBe("Not connected");
  });

  it("ignores a locale it does not ship", () => {
    useLocaleStore.getState().setLocale("de" as never);
    expect(useLocaleStore.getState().locale).toBe("en");
  });

  it("hydrate reads the saved choice", () => {
    localStorage.setItem(LOCALE_KEY, "pt-BR");
    useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().locale).toBe("pt-BR");
  });
});

describe("plural and Intl", () => {
  it("picks the plural form per locale and formats the count", () => {
    expect(translatePlural("en", "shell.status.nodes", 1)).toBe("1 node");
    expect(translatePlural("en", "shell.status.nodes", 3)).toBe("3 nodes");
    expect(translatePlural("pt-BR", "shell.status.nodes", 2)).toBe("2 nós");
    expect(translatePlural("pt-BR", "shell.status.connections", 1)).toBe("1 conexão");
    expect(translatePlural("en", "shell.palette.results", 1200)).toBe("1,200 results");
    expect(translatePlural("pt-BR", "shell.palette.results", 1200)).toBe("1.200 resultados");
  });

  it("formats numbers and dates in the chosen language", () => {
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    expect(formatNumber("pt-BR", 1234.5)).toBe("1.234,5");
    const d = new Date(Date.UTC(2026, 9, 30, 12));
    expect(formatDate("en", d, { dateStyle: "long", timeZone: "UTC" })).toBe("October 30, 2026");
    expect(formatDate("pt-BR", d, { dateStyle: "long", timeZone: "UTC" })).toBe("30 de outubro de 2026");
  });

  it("gives every plural message an `other` form for each `one`", () => {
    for (const k of Object.keys(en)) if (k.endsWith(".one")) expect(en, k).toHaveProperty(`${k.slice(0, -4)}.other`);
  });
});
