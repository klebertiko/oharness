import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages.en";
import { ptBR } from "@/i18n/messages.pt-BR";
import { translate } from "@/i18n/translate";
import { cordisTitle, parseCordisArgs } from "./cordisAction";

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate("pt-BR", key, vars);

describe("cordisAction", () => {
  it("reads the args as JSON text and ignores what is not an action", () => {
    expect(parseCordisArgs('{"action":"write_file","name":"x","path":"a.js"}')).toEqual({ action: "write_file", name: "x", path: "a.js" });
    expect(parseCordisArgs("not json")).toEqual({});
    expect(parseCordisArgs('{"action":5}')).toEqual({});
  });

  it("describes every action in plain words, and never as exec or Run command", () => {
    const cases: [string, string][] = [
      ["write_file", "Escrever arquivo do plugin x"],
      ["request_install", "Pedir instalação de x"],
      ["scaffold", "Criar o plugin x"],
      ["read_file", "Ler arquivo do plugin x"],
      ["preview", "Prévia do plugin x"],
      ["logs", "Ler os logs do plugin x"],
      ["list", "Listar os plugins em desenvolvimento"],
      ["api_catalog", "Ler o catálogo de APIs do host"],
      ["starters", "Ler os arquivos de partida"],
    ];
    for (const [action, text] of cases) expect(cordisTitle(JSON.stringify({ action, name: "x" }), t), action).toBe(text);
    expect(cordisTitle("{}", t)).toBe("Usar a ferramenta de plugins");
    expect(cordisTitle('{"action":"write_file"}', t)).toBe("Escrever arquivo do plugin (sem nome)");
    for (const key of Object.keys(en).filter((k) => k.startsWith("plugins.approval."))) {
      expect(`${en[key as keyof typeof en]} ${ptBR[key as keyof typeof ptBR]}`).not.toMatch(/\bexec\b|run command/i);
    }
  });
});
