import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { en } from "@/i18n/messages.en";
import { ptBR } from "@/i18n/messages.pt-BR";

const ROOT = path.resolve(__dirname, "..");
const PHRASE = /rename|nickname|nome do assistente|assistant name/i;
const NAME_LABEL = /rename|nickname|nome do assistente|assistant name|^(name|nome)$/i;

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

function fieldLabel(el: Element): string {
  const id = el.getAttribute("id");
  const labelled = id
    ? [...el.ownerDocument.querySelectorAll("label")].find((label) => label.getAttribute("for") === id)
    : null;
  return [
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("placeholder") ?? "",
    labelled?.textContent ?? "",
  ].join(" ");
}

async function renderSurface(relative: string, exportName: string) {
  const file = path.join(ROOT, relative);
  if (!existsSync(file)) return;
  const mod = await import(/* @vite-ignore */ file);
  const Component = mod[exportName];
  if (typeof Component !== "function") return;
  const view = render(createElement(Component));
  try {
    for (const el of view.container.querySelectorAll("input, textarea")) {
      expect(fieldLabel(el).trim(), relative).not.toMatch(NAME_LABEL);
    }
  } finally {
    cleanup();
  }
}

it("nilo copy never offers a rename and spells Nilo the same in both languages", () => {
  const keys = (Object.keys(en) as string[]).filter((key) => key.startsWith("nilo."));
  for (const key of keys) {
    const enValue = en[key as keyof typeof en];
    const ptValue = ptBR[key as keyof typeof ptBR];
    expect(key, key).not.toMatch(PHRASE);
    expect(enValue, key).not.toMatch(PHRASE);
    expect(ptValue, key).not.toMatch(PHRASE);
    for (const value of [enValue, ptValue]) {
      for (const hit of value.match(/nilo/gi) ?? []) expect(hit, key).toBe("Nilo");
    }
  }
});

it("the Nilo page and the settings section have no name field", async () => {
  for (const file of filesUnder(ROOT)) {
    if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
    if (!/\.(tsx|ts)$/.test(file)) continue;
    expect(readFileSync(file, "utf8"), file).not.toMatch(PHRASE);
  }
  await renderSurface("profile/NiloPage.tsx", "NiloPage");
  await renderSurface("profile/NiloSettingsSection.tsx", "NiloSettingsSection");
});
