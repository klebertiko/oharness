import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages.en";
import { ptBR } from "@/i18n/messages.pt-BR";
import type { MessageKey } from "@/i18n/translate";
import { catalogCodeFromFault, catalogCodeFromWire, PROVIDER_ERROR_ACTION, PROVIDER_ERROR_CODES, providerErrorText } from "./errorCatalog";

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

describe("wire class to catalog code", () => {
  it("maps every class the sidecar emits onto one catalog row, and nothing else", () => {
    expect(catalogCodeFromWire("authentication")).toBe("authentication");
    expect(catalogCodeFromWire("cli-signin")).toBe("cli_signed_out");
    expect(catalogCodeFromWire("cli-missing")).toBe("cli_missing");
    expect(catalogCodeFromWire("cli-timeout")).toBe("timeout");
    expect(catalogCodeFromWire("timeout")).toBe("timeout");
    expect(catalogCodeFromWire("usage_limit")).toBe("usage_limit");
    expect(catalogCodeFromWire("overload")).toBe("overload");
    expect(catalogCodeFromWire("transport")).toBe("endpoint_unreachable");
    expect(catalogCodeFromWire("cli-error")).toBeNull();
    expect(catalogCodeFromWire("usage limit reached at 6:20 person@example.com")).toBeNull();
    expect(catalogCodeFromWire(undefined)).toBeNull();
    expect(catalogCodeFromWire(429)).toBeNull();
  });

  it("maps a connection's failure class onto the same rows", () => {
    expect(catalogCodeFromFault("key-rejected")).toBe("authentication");
    expect(catalogCodeFromFault("unreachable")).toBe("endpoint_unreachable");
    expect(catalogCodeFromFault("rate-limited")).toBe("http_429");
    expect(catalogCodeFromFault("cli-signin")).toBe("cli_signed_out");
    expect(catalogCodeFromFault("cli-missing")).toBe("cli_missing");
    expect(catalogCodeFromFault("cli-timeout")).toBe("timeout");
    expect(catalogCodeFromFault("usage_limit")).toBe("usage_limit");
    expect(catalogCodeFromFault("overload")).toBe("overload");
    expect(catalogCodeFromFault("timeout")).toBe("timeout");
    expect(catalogCodeFromFault("unknown")).toBeNull();
    expect(catalogCodeFromFault(null)).toBeNull();
  });
});

describe("orphan copy", () => {
  it("keeps no handoff keys in either language", () => {
    expect(Object.keys(en).filter((k) => k.startsWith("handoff."))).toEqual([]);
    expect(Object.keys(ptBR).filter((k) => k.startsWith("handoff."))).toEqual([]);
  });
});
