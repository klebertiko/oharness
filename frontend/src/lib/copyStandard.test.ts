import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { en } from "@/i18n/messages.en";
import { ptBR } from "@/i18n/messages.pt-BR";
import { BUNDLED_HARNESS_COMMAND_GROUP, fetchStudioExamples } from "./studioExamples";
import { HARNESS_PRESETS } from "./templates";

/**
 * Copy standard: everything the app ships is a "harness". Names and
 * descriptions shown in the Studio never say framework / sample / template /
 * preset / Copilot (the assistant is Nilo). A source may still be cited by its
 * project name, `skills-framework`. See CONTEXT.md.
 */
const FORBIDDEN = /framework|sample|template|preset|copilot/i;
const noForbidden = (text: string) => !FORBIDDEN.test(text.replace(/skills-framework/gi, ""));

afterEach(() => vi.unstubAllGlobals());

it("the Studio example list names no harness a sample, preset, template or framework", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  const examples = await fetchStudioExamples();
  expect(examples.length).toBeGreaterThan(0);
  for (const ex of examples) {
    expect(noForbidden(ex.name), ex.name).toBe(true);
    expect(noForbidden(ex.description), ex.description).toBe(true);
  }
});

it("every built-in harness (preset) is named and described as a harness", () => {
  for (const p of HARNESS_PRESETS) {
    expect(noForbidden(p.name), p.name).toBe(true);
    expect(noForbidden(p.description), p.description).toBe(true);
  }
});

it("the command palette groups the bundled harnesses under the same label as the Studio actions bar (#113)", () => {
  expect(BUNDLED_HARNESS_COMMAND_GROUP).toBe("Open bundled harness");
  expect(noForbidden(BUNDLED_HARNESS_COMMAND_GROUP)).toBe(true);
});

// sha256 of lowercase third-party app names. The plaintext stays out of the source.
const APP_NAME_HASHES = new Set([
  "60965168ce762e949600281ba6d01fee136e5b6e8257b1f216f9025ed324474c",
  "5d72436256ada53828b51895a94bb8489e9f1ac4fe937a8024ef1594e7045ff6",
  "9058f79c893a1d7e20b13009b95b9cf3211478a91a47e2ad65bdfedad6fc98f4",
  "45d780f82c9247fc1142f8b60c12b6c6cd3d9f23dd836cfa6e84c498d2f83292",
  "6db7636b5922f26c1eb855fda18da3c40913d6237e21a90fb155b85868b9bfde",
  "81ed341348bed14c507f31afb5d1afed2262e97378012e59f5e9e03e4e6ecd38",
  "7764735c5d4d88ae3ef1c0d6c0a5769e4187c341895db19a82ba7d4e17b8c914",
  "0e3ef6d103af163dcdffe26b76485f38af7f1d697ce05034c107de73eff16afb",
]);

function citedApp(text: string): string | null {
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const digest = createHash("sha256").update(token).digest("hex");
    if (APP_NAME_HASHES.has(digest)) return digest;
  }
  return null;
}

function niloSources(): string[] {
  const root = path.resolve(__dirname, "../nilo");
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(full)) out.push(readFileSync(full, "utf8"));
    }
  };
  walk(root);
  return out;
}

it("nilo copy cites no other app and uses none of the retired words", () => {
  const strings = [
    ...niloSources(),
    ...(Object.keys(en) as (keyof typeof en)[])
      .filter((key) => key.startsWith("nilo."))
      .flatMap((key) => [en[key], ptBR[key]]),
  ];
  for (const text of strings) {
    expect(noForbidden(text), text.slice(0, 80)).toBe(true);
    expect(citedApp(text)).toBeNull();
  }
});
