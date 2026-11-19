import { afterEach, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { credentialDetail, type Connection } from "./providerStore";

const conn = (provider: string): Connection =>
  ({ id: "c", provider, label: "L", residence: "cloud", endpoint: "", secret: null, health: "setup", detail: "", probes: [], facts: [], models: [], defaultModel: "", enabled: false, lastProbe: "" }) as Connection;

afterEach(() => useLocaleStore.setState({ locale: "en" }));

it("says the offline credential state in English", () => {
  expect(credentialDetail(conn("openrouter"))).toBe("Not connected. Add a key from openrouter.ai, Keys.");
  expect(credentialDetail(conn("ollama"))).toContain("Not connected.");
});

it("says the offline credential state in Portuguese, with where-to-get from the catalogue of messages", () => {
  useLocaleStore.setState({ locale: "pt-BR" });
  for (const provider of ["openrouter", "anthropic", "openai-compatible"]) {
    const d = credentialDetail(conn(provider));
    expect(d.startsWith("Não conectado."), d).toBe(true);
    expect(d).not.toMatch(/Not connected|Add a key|The server's own/);
  }
  expect(credentialDetail(conn("openai-compatible"))).toContain("As configurações do próprio servidor");
});
