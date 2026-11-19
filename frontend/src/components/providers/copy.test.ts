import { en } from "@/i18n/messages.en";
import { ptBR } from "@/i18n/messages.pt-BR";
import { PROVIDERS_BIND_NONE } from "./copy";
import { PROVIDER_TEXT_KEY } from "./labels";
import { OLLAMA_CLOUD, PROVIDERS } from "./catalog";
import { expect, test } from "vitest";

test("bind placeholder does not mention Wallet", () => {
  expect(PROVIDERS_BIND_NONE.toLowerCase()).not.toContain("wallet");
  expect(PROVIDERS_BIND_NONE).toContain("Providers");
});

test("every catalogue provider has its summary, caveat, where and vendor text in both languages", () => {
  const specs = [...Object.values(PROVIDERS), OLLAMA_CLOUD];
  for (const spec of specs) {
    const key = spec.id === "ollama" && spec.catalogue === "hosted" ? "ollamaCloud" : spec.id;
    const k = PROVIDER_TEXT_KEY[key as keyof typeof PROVIDER_TEXT_KEY];
    expect(k, `no text keys for ${spec.id}`).toBeTruthy();
    for (const name of [k.summary, k.caveat, k.where].filter(Boolean) as string[]) {
      expect((en as Record<string, string>)[name], `en ${name}`).toBeTruthy();
      expect((ptBR as Record<string, string>)[name], `pt-BR ${name}`).toBeTruthy();
    }
  }
});
