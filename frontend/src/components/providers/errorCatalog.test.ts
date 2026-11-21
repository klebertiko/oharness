import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages.en";
import { ptBR } from "@/i18n/messages.pt-BR";
import type { MessageKey } from "@/i18n/translate";
import { PROVIDER_ERROR_ACTION, PROVIDER_ERROR_CODES, providerErrorText } from "./errorCatalog";

const FORBIDDEN = /\b(residence|capability|billing|handoff|preset|framework|sample|template|copilot)\b/i;

describe("provider error catalog", () => {
  it("covers every class with what, why, and an action in both languages", () => {
    expect(PROVIDER_ERROR_CODES).toHaveLength(12);
    const seen = new Set<string>();
    for (const code of PROVIDER_ERROR_CODES) {
      const keys = providerErrorText(code);
      for (const key of [keys.what, keys.why, keys.action]) {
        expect(en[key].trim(), `en ${key}`).not.toBe("");
        expect(ptBR[key].trim(), `pt-BR ${key}`).not.toBe("");
        expect(en[key]).not.toMatch(FORBIDDEN);
        expect(ptBR[key]).not.toMatch(FORBIDDEN);
      }
      expect(PROVIDER_ERROR_ACTION[code]).toBeTruthy();
      seen.add(code);
    }
    expect(seen.size).toBe(PROVIDER_ERROR_CODES.length);
    expect(PROVIDER_ERROR_ACTION.http_429).toBe(PROVIDER_ERROR_ACTION.usage_limit);
  });

  it("does not invent a class outside the catalog", () => {
    const known = new Set<string>(PROVIDER_ERROR_CODES);
    for (const key of Object.keys(en) as MessageKey[]) {
      const match = /^providers\.error\.([^.]+)\./.exec(key);
      if (match) expect(known.has(match[1])).toBe(true);
    }
  });
});
