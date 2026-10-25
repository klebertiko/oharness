import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(resolve(frontend, "src/lib/fixtures/ohm-roundtrip.json"), "utf8"));
const output = resolve(frontend, "../.harness/sprint-2026-09-12/story-OHM-ROUNDTRIP-ASTRA/evidence/e2e");
mkdirSync(output, { recursive: true });
const startedAt = new Date().toISOString();
const resultPath = resolve(output, "result.json");
writeFileSync(resultPath, JSON.stringify({ result: "running", startedAt }, null, 2));
const browser = await chromium.launch(process.env.OHM_BROWSER_EXECUTABLE ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true } : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const validations = [];
const errors = [];
const browserLog = [];
const unexpectedRequests = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => browserLog.push(`${message.type()}: ${message.text()}`));
await context.addInitScript(() => { window.__OH_API__ = "http://127.0.0.1:8000"; });
// Only the HTTP boundary is stubbed; UI, stores, file parsing and download are real.
// No request can reach the user's sidecar or modify its database.
await context.route("http://127.0.0.1:8000/**", async route => {
  const path = new URL(route.request().url()).pathname;
  const request = `${route.request().method()} ${path}`;
  const responses = {
    "GET /bundles/default": fixture,
    "GET /bundles/examples": { examples: [] },
    "GET /harnesses/": [],
    "GET /health": { status: "ok" },
    "GET /cowork/projects": { projects: [] },
    "GET /providers/connections": { connections: [] },
  };
  let body = responses[request];
  if (request === "POST /bundles/validate") {
    validations.push(route.request().postDataJSON());
    body = { ok: true, errors: [] };
  } else if (!Object.hasOwn(responses, request)) {
    unexpectedRequests.push(request);
    await route.fulfill({ status: 501, contentType: "application/json", body: JSON.stringify({ detail: `Unstubbed E2E request: ${request}` }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});

async function upload(bundle, name) {
  // The Validate dock owns the one .ohm import input; this flow asserts its "Imported · id" status.
  await page.locator('input[type="file"][accept=".ohm,.oharness,application/json"]').first().setInputFiles({
    name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await page.getByText(`Imported · ${bundle.manifest.id}`, { exact: true }).waitFor();
}
async function download(name) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .ohm", exact: true }).click();
  const file = await pending;
  await file.saveAs(resolve(output, name));
  return JSON.parse(readFileSync(resolve(output, name), "utf8"));
}
// ReactFlow measures rendered nodes; these fields are not part of the fixture's authoring data.
const REACTFLOW_RUNTIME_KEYS = ["measured", "selected", "dragging"];
function authoring(bundle) {
  const copy = structuredClone(bundle);
  copy.graph.nodes = copy.graph.nodes.map((node) => {
    const rest = { ...node };
    for (const key of REACTFLOW_RUNTIME_KEYS) delete rest[key];
    return rest;
  });
  return copy;
}

try {
  await page.goto(process.env.OHM_E2E_URL || "http://127.0.0.1:3000", { waitUntil: "networkidle" });
  assert.equal(await page.getByText("Unhandled Runtime Error", { exact: true }).count(), 0, "Next.js must not show a runtime error overlay");
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByRole("button", { name: "Open harness: Agent + review", exact: true }).click();
  await upload(fixture, "fixture.ohm");
  const first = await download("first.ohm");
  assert.deepEqual(authoring(first), fixture, "First download must preserve the authored fixture");
  await upload(first, "reimport.ohm");
  const second = await download("second.ohm");
  assert.deepEqual(authoring(second), authoring(first), "Export/import/export must be stable");
  assert.deepEqual(validations, [fixture, first], "Both real file imports must reach validation unchanged");
  assert.deepEqual(errors, [], "Browser must not raise uncaught application errors");
  assert.deepEqual(unexpectedRequests, [], "Every sidecar request must have an explicit contract fixture");
  assert.equal(await page.getByText("Unhandled Runtime Error", { exact: true }).count(), 0, "Next.js must not show a runtime error overlay");
  await page.screenshot({ path: resolve(output, "roundtrip.png") });
  writeFileSync(resultPath, JSON.stringify({ result: "passed", startedAt, finishedAt: new Date().toISOString(), scope: "Browser UI E2E with sidecar HTTP stubs", imports: validations.length, pageErrors: errors, unexpectedRequests }, null, 2));
  process.stdout.write("PASS: real browser import -> download -> reimport -> download; authored objects equal. Sidecar HTTP stubbed.\n");
} catch (error) {
  writeFileSync(resultPath, JSON.stringify({ result: "failed", startedAt, finishedAt: new Date().toISOString(), error: error.message, pageErrors: errors, unexpectedRequests, browserLog }, null, 2));
  writeFileSync(resolve(output, "failure.txt"), `${error.stack}\nPage errors: ${JSON.stringify(errors)}\n${await page.locator("body").innerText()}`);
  await page.screenshot({ path: resolve(output, "failure.png") });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
