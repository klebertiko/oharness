import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(import.meta.dirname, '../../.harness/sprint-2026-09-15/story-STUDIO-CODEX/evidence');
mkdirSync(output, { recursive: true });
const fixture = JSON.parse(readFileSync('src/lib/fixtures/ohm-roundtrip.json', 'utf8'));
const errors = [], unexpected = [], executions = [], checks = [], responsive = [];
let step = 'startup', rejectValidation = false;
const startedAt = new Date().toISOString();
const report = data => writeFileSync(resolve(output, 'e2e.json'), JSON.stringify({ startedAt, step, checks, errors, unexpected, executions, responsive, ...data }, null, 2));
report({ result: 'running' });
const browser = await chromium.launch(process.env.OHM_BROWSER_EXECUTABLE ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true } : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && /ReferenceError|TypeError|BaseNode/.test(m.text())) errors.push(m.text()); });
const base = process.env.OHM_E2E_URL || 'http://127.0.0.1:3000';
await context.addInitScript(() => { window.__OH_API__ = 'http://127.0.0.1:18099'; });
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.origin === new URL(base).origin) return route.continue();
  if (url.origin !== 'http://127.0.0.1:18099') { unexpected.push(req.method() + ' ' + url.origin + url.pathname); return route.abort(); }
  const key = req.method() + ' ' + url.pathname;
  const responses = {
    'GET /health': { status: 'ok' }, 'GET /bundles/default': fixture,
    'GET /cowork/projects': { projects: [] },
    'GET /harnesses/': [], 'GET /bundles/examples': { examples: [] },
    'GET /providers/connections': { connections: [
      // hydrate() only merges rows whose id is in the offline template.
      { id: 'openai', provider: 'openai', label: 'Studio A', enabled: true, residence: 'cloud', endpoint: '', secretRef: null },
      { id: 'ollama-local', provider: 'ollama', label: 'Studio B', enabled: true, residence: 'local', endpoint: 'http://127.0.0.1:11434', secretRef: null },
    ] },
  };
  if (key === 'POST /execute/') {
    executions.push(req.postDataJSON());
    return route.fulfill({ contentType: 'text/event-stream', body: 'event: run_start\ndata: {"run_id":"isolated-studio"}\n\nevent: harness_done\ndata: {"status":"completed"}\n\n' });
  }
  let body = responses[key];
  if (key === 'POST /bundles/validate') body = { ok: !rejectValidation, errors: rejectValidation ? ['Isolated invalid bundle'] : [] };
  if (key === 'POST /harnesses/') body = { id: 'e2e-harness', name: req.postDataJSON().name };
  // Autosave of an edit to the harness the first POST created; whether it lands as a POST or a PUT depends on timing.
  if (req.method() === 'PUT' && /^\/harnesses\/[^/]+$/.test(url.pathname)) body = { id: url.pathname.split('/').pop(), name: req.postDataJSON().name };
  if (key === 'POST /bundles/mock') body = { ok: true, errors: [], steps: [{ nodeId: 'impl', role: 'agent', status: 'simulated', note: 'isolated plan' }] };
  if (!body) { unexpected.push(key); return route.fulfill({ status: 501, body: '{}' }); }
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
});
const button = name => page.getByRole('button', { name, exact: true });
async function download(name) {
  const pending = page.waitForEvent('download');
  await button('Export .ohm').click();
  const file = await pending; await file.saveAs(resolve(output, name));
  return JSON.parse(readFileSync(resolve(output, name), 'utf8'));
}
const REACTFLOW_RUNTIME_KEYS = ["measured", "selected", "dragging"];
function authored(bundle) {
  const copy = structuredClone(bundle);
  copy.graph.nodes = copy.graph.nodes.map((node) => {
    const rest = { ...node };
    for (const key of REACTFLOW_RUNTIME_KEYS) delete rest[key];
    return rest;
  });
  return copy;
}
try {
  await page.goto(base, { waitUntil: 'networkidle', timeout: 120000 });
  await button('Studio').click();
  step = 'BaseNode sample reproduction';
  await button('Open harness: Agent + review').click();
  await page.locator('.react-flow__node[data-id="impl"]').waitFor();
  assert.deepEqual(errors, []); checks.push('Current BaseNode sample renders without historical Play error');
  await page.locator('.react-flow__node[data-id="impl"]').click();
  await page.getByLabel('Label', { exact: true }).fill('Codex draft preserved');
  // The pin is a Combobox (eced171), not a <select>.
  await page.getByRole('button', { name: /^Connection pin:/ }).click();
  await page.getByRole('option', { name: /^Studio A/ }).click();
  await button('Back to Studio').click(); await page.getByRole('button', { name: /^Continue editing/ }).click();
  await page.getByText('Codex draft preserved', { exact: true }).first().waitFor();
  checks.push('Inspector edit and pin survive Back/Continue');
  step = 'Validate and simulation feedback';
  await button('Validate').click(); await page.getByText('Bundle valid', { exact: true }).waitFor();
  await button('Plan simulation').click(); await page.getByText('Simulation plan · 1 step · no provider called', { exact: true }).waitFor();
  await page.getByLabel('Label', { exact: true }).fill('Updated draft');
  assert.equal(await page.getByText(/Simulation plan ·/).count(), 0);
  rejectValidation = true; await button('Validate').click(); await page.getByText('Isolated invalid bundle', { exact: true }).waitFor();
  rejectValidation = false;
  checks.push('Validate success/rejection and simulation invalidation');
  step = 'Mode and provider execution request';
  await page.getByRole('radio', { name: 'Mock', exact: true }).click();
  await page.getByRole('button', { name: /^Run/ }).click();
  await page.waitForFunction(() => !document.querySelector('button')?.disabled);
  await page.getByRole('radio', { name: 'Connected', exact: true }).click();
  await page.getByRole('button', { name: /^Run/ }).click();
  await page.getByRole('radio', { name: 'Mock', exact: true }).waitFor();
  assert.equal(executions.length, 2); assert.equal(executions[0].mode, 'mock'); assert.equal(executions[1].mode, 'live');
  assert.deepEqual(executions[1].graph_json.nodes.find(n => n.id === 'impl').data.providerIds, ['openai']);
  checks.push('Mock/live serialized mode and selected pin verified; execution response stubbed');
  step = 'OHM roundtrip and rejected import';
  // The validate dock owns the .ohm import input and reports "Imported · <id>".
  const upload = bundle => page.locator('input[type="file"][accept=".ohm,.oharness,application/json"]').first().setInputFiles({ name: 'roundtrip.ohm', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await upload(fixture); await page.getByText('Imported · ' + fixture.manifest.id, { exact: true }).waitFor();
  const first = await download('first.ohm'); assert.deepEqual(authored(first), fixture);
  await upload(first); await page.getByText('Imported · ' + fixture.manifest.id, { exact: true }).waitFor();
  const second = await download('second.ohm'); assert.deepEqual(authored(second), authored(first));
  rejectValidation = true; await upload({ ...fixture, manifest: { ...fixture.manifest, name: 'Rejected replacement' } });
  await page.getByText('Import failed validation', { exact: true }).waitFor();
  assert.deepEqual(authored(await download('after-rejected.ohm')), authored(second));
  checks.push('Literal Astra fixture roundtrip and rejected import preserve full draft');
  step = 'responsive evidence';
  await button('Back to Studio').click();
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    responsive.push({ width, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
    await page.screenshot({ path: resolve(output, 'overview-' + width + '.png') });
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  report({ result: 'passed', finishedAt: new Date().toISOString(), limitation: 'Real Edge UI; all sidecar HTTP stubbed, no engine/provider/database executed.' });
} catch (error) {
  report({ result: 'failed', error: error.stack });
  writeFileSync(resolve(output, 'failure.txt'), await page.locator('body').innerText());
  await page.screenshot({ path: resolve(output, 'failure.png') });
  throw error;
} finally { await context.close(); await browser.close(); }
