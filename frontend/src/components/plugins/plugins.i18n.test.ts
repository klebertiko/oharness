import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages.en";
import { ptBR } from "@/i18n/messages.pt-BR";

const keys = Object.keys(en).filter((k) => k.startsWith("plugins."));

describe("plugins.* catalog", () => {
  it("has the keys in en and pt-BR, none empty", () => {
    expect(keys.length).toBeGreaterThan(60);
    for (const key of keys) {
      expect(ptBR[key as keyof typeof ptBR]?.trim(), key).toBeTruthy();
      expect(en[key as keyof typeof en].trim(), key).not.toBe("");
    }
    expect(Object.keys(ptBR).filter((k) => k.startsWith("plugins.")).sort()).toEqual([...keys].sort());
  });

  it("covers every literal plugins.* key the screen uses, and every dynamic family", () => {
    const dir = __dirname;
    const used = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test.") && f !== "testKit.ts")) {
      for (const m of readFileSync(join(dir, file), "utf8").matchAll(/"(plugins\.[A-Za-z0-9.-]+)"/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(30);
    for (const key of used) expect(keys, key).toContain(key);
    for (const state of ["active", "pending", "failed", "disabled", "changed", "unavailable"]) expect(keys).toContain(`plugins.state.${state}`);
    for (const c of ["files", "network", "processes", "credentials"]) expect(keys).toEqual(expect.arrayContaining([`plugins.capability.${c}`, `plugins.capability.${c}.grant`]));
    for (const r of ["isolated", "in-process"]) expect(keys).toContain(`plugins.runtime.${r}`);
  });

  it("keeps the words the product avoids out of the copy", () => {
    for (const key of keys) expect(`${en[key as keyof typeof en]} ${ptBR[key as keyof typeof ptBR]}`, key).not.toMatch(/framework|sample|template|preset|copilot/i);
  });
});
