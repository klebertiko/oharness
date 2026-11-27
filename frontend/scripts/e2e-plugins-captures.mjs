/**
 * Cordis Plugins in Portuguese, dark and light, at 1280px: the screens that carry the 8- captures of the story (a decision for each script,
 * the live log, the Tarball source, the fixed Descobrir notice, the four capabilities in the review and in the details, Export), with axe at
 * each one. The same stubbed sidecar as e2e-plugins.mjs. OH_E2E_CAPTURES_DIR sends the 8- PNGs somewhere else (the story's evidence folder);
 * by default they stay under .e2e-out/plugins.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { settleForAxe } from "./axe-settle.mjs";
import { evidenceDir } from "./e2e-evidence.mjs";
import { API, launchOptions, routeSidecar, sidecar } from "./plugins-stub.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const out = process.env.OH_E2E_CAPTURES_DIR || evidenceDir("plugins");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(launchOptions(require));
let checked = 0;
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
    await context.addInitScript(([t, api]) => {
      try {
        localStorage.setItem("oharness-theme", t);
        localStorage.setItem("oharness-locale", "pt-BR");
      } catch { /* storage blocked */ }
      window.__OH_API__ = api;
      window.__OH_HUMAN__ = "e2e-human";
    }, [theme, API]);
    const stub = sidecar();
    await routeSidecar(context, base, stub);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(`${base}/plugins`, { waitUntil: "networkidle" });
    const check = async (label) => {
      await settleForAxe(page);
      await page.addScriptTag({ content: axeSource });
      const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).join(", ")}`));
      assert.deepEqual(v, [], `${label}: axe`);
      checked += 1;
    };
    const shot = (name) => page.screenshot({ path: join(out, `8-${name}-${theme}.png`), fullPage: false });

    // Detalhes: as quatro capacidades e Exportar.
    await page.getByRole("button", { name: "Detalhes de notes-tool" }).click();
    const detail = page.getByRole("region", { name: "Detalhes de notes-tool" });
    await detail.getByRole("list", { name: "O que cada capacidade faz" }).waitFor();
    await detail.getByText("Só declarada", { exact: true }).waitFor();
    await detail.getByText("Bloqueada", { exact: true }).first().scrollIntoViewIfNeeded();
    await check(`capacidades detalhe ${theme}`);
    await shot("capacidades-detalhe");
    await detail.getByRole("region", { name: "Exportar" }).scrollIntoViewIfNeeded();
    await detail.getByRole("button", { name: "Baixar índice (index.json)" }).waitFor();
    assert.equal(await detail.getByRole("button", { name: /publicar/i }).count(), 0, "nothing to publish");
    await check(`exportar ${theme}`);
    await shot("exportar");
    await detail.getByRole("button", { name: "Fechar detalhes" }).click();

    // Adicionar: Tarball, log ao vivo, prévia com capacidades e scripts por pacote.
    await page.getByRole("button", { name: "Adicionar plugin" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Adicionar um plugin" });
    await dialog.getByRole("radio", { name: "Tarball" }).click();
    await dialog.getByLabel("Endereço (https) ou caminho absoluto de um .tgz").fill("https://example.com/echo-tool-0.3.1.tgz");
    await dialog.getByRole("button", { name: "Verificar pacote" }).click();
    await dialog.getByText("Um endereço da web exige o hash.").waitFor();
    await check(`tarball ${theme}`);
    await shot("tarball");
    await dialog.getByRole("radio", { name: "npm" }).click();
    await dialog.getByLabel("Nome do pacote").fill("echo-tool");
    await dialog.getByLabel("Versão exata").fill("0.3.1");
    stub.state.hold = true;
    await dialog.getByRole("button", { name: "Verificar pacote" }).click();
    await dialog.getByRole("log", { name: "Andamento" }).getByText("Conferindo a integridade").waitFor();
    await check(`log ao vivo ${theme}`);
    await shot("log-ao-vivo");
    stub.state.hold = false;
    await dialog.getByText("Confira antes de instalar").waitFor();
    await dialog.getByRole("list", { name: "O que cada capacidade faz" }).scrollIntoViewIfNeeded();
    await check(`capacidades prévia ${theme}`);
    await shot("capacidades-previa");
    await dialog.getByRole("radiogroup", { name: "Decisão para o script postinstall" }).getByRole("radio", { name: "Aceitar sem executar" }).check();
    await dialog.getByRole("radiogroup", { name: "Decisão para o script prepare" }).scrollIntoViewIfNeeded();
    await check(`scripts por pacote ${theme}`);
    await shot("scripts-por-pacote");
    await dialog.getByRole("button", { name: "Voltar" }).click();
    await dialog.getByRole("button", { name: "Cancelar" }).click();

    // Descobrir: o aviso fixo no topo.
    await page.getByRole("radio", { name: "Descobrir" }).click();
    await page.getByText("Lista não revisada: os índices são de terceiros; confira a fonte antes de instalar.").waitFor();
    await page.getByLabel("Endereço do índice (https)").fill("https://example.com/index.json");
    await page.getByRole("button", { name: "Carregar índice" }).click();
    await page.getByRole("button", { name: "Inspecionar tar-thing" }).waitFor();
    await check(`descobrir ${theme}`);
    await shot("descobrir-aviso");
    await context.close();
  }
  console.log(`Plugins (pt-BR): ${checked} axe checks passed; captures in ${out}.`);
} finally {
  await browser.close();
}
