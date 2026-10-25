import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(import.meta.dirname, '../../.harness/sprint-2026-10-21/story-CHAT-PROVIDERS/evidence');
mkdirSync(output, { recursive: true });
const fixture = JSON.parse(readFileSync('src/lib/fixtures/ohm-roundtrip.json', 'utf8'));
const base = process.env.OHM_E2E_URL || 'http://127.0.0.1:3000';
const sidecar = 'http://127.0.0.1:18099';
const checks = [], unexpected = [], errors = [], requests = [], responsive = [];
let step = 'startup', rejectRun = false, rejectUsage = false, rejectBudget = true;
const browser = await chromium.launch(process.env.OHM_BROWSER_EXECUTABLE ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true } : { channel: process.env.OHM_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  window.__OH_API__ = 'http://127.0.0.1:18099';
  localStorage.setItem('oh.harnessSession', JSON.stringify({ enabled: false, activeBundleId: null }));
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => {
    if (window.__rejectCopy) throw new Error('isolated clipboard denial');
    window.__copied.push(text);
  } } });
});
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.origin === new URL(base).origin) return route.continue();
  const key = req.method() + ' ' + url.pathname;
  if (url.origin !== sidecar) { unexpected.push(key); return route.abort(); }
  if (key === 'GET /usage/summary' && rejectUsage) return route.fulfill({ status: 503, body: 'isolated usage unavailable' });
  if (key === 'PUT /usage/budget') return route.fulfill({ status: rejectBudget ? 503 : 200, contentType: 'application/json', body: rejectBudget ? 'isolated budget unavailable' : JSON.stringify({ limitUsd: req.postDataJSON().limitUsd, spentUsd: 0, remainingUsd: 15, pct: 0, state: 'ok' }) });
  if (key === 'POST /execute/direct') {
    requests.push(req.postDataJSON());
    if (rejectRun) return route.fulfill({ status: 503, body: 'isolated sidecar unavailable' });
    const frames = [
      ['run_start', { run_id: 'isolated-chat-' + requests.length, order: [{ node_id: 'direct', type: 'agent', label: 'Reply' }] }],
      ['node_start', { node_id: 'direct', adapter: 'ollama', model: 'qa-model' }],
      ['node_stream', { node_id: 'direct', chunk: 'Synthetic streamed answer' }],
      ['node_done', { node_id: 'direct', output: 'Synthetic completed answer', tokens: 4 }],
      ['harness_done', { tokens: 4 }],
    ];
    return route.fulfill({ contentType: 'text/event-stream', body: frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('') });
  }
  const responses = {
    'GET /health': { status: 'ok' }, 'GET /bundles/default': fixture,
    'GET /cowork/projects': { projects: [] }, 'GET /harnesses/': [],
    'GET /bundles/examples': { examples: [] },
    'GET /providers/connections': { connections: [{ id: 'ollama-local', provider: 'ollama', label: 'QA local', enabled: true, residence: 'local', endpoint: 'http://127.0.0.1:11434', secretRef: null, defaultModel: 'qa-default' }] },
    'GET /usage/summary': { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, byConnection: [], bySource: [], budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: 'unset' } },
  };
  if (!(key in responses)) { unexpected.push(key); return route.fulfill({ status: 501, body: '{}' }); }
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(responses[key]) });
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const composer = () => page.getByRole('textbox', { name: 'Message OHarness' });
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  step = 'explicit model and completion';
  await button('Model for next turn: Connection default').click();
  await page.getByRole('combobox').fill('qa-model');
  await page.getByRole('combobox').press('Enter');
  await composer().fill('Synthetic QA prompt');
  await button('Send message').click();
  await page.getByText('Synthetic completed answer', { exact: true }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'qa-model');
  assert.equal(requests[0].connection_id, 'ollama-local');
  checks.push('Send completes and request carries explicit model/connection');
  step = 'copy and reuse';
  await button('Copy message').last().click();
  await page.getByText('Copied', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__copied.at(-1)), 'Synthetic completed answer');
  await page.evaluate(() => { window.__rejectCopy = true; });
  await button('Copy message').last().click();
  await page.getByText('Could not copy. Select the message text and copy it manually.', { exact: true }).waitFor();
  await button('Reuse message').last().click();
  assert.equal(await composer().inputValue(), 'Synthetic completed answer');
  assert.equal(requests.length, 1);
  checks.push('Copy success/denial feedback and reuse only edits composer');
  step = 'recover failed transport';
  rejectRun = true;
  await composer().fill('Recover this synthetic instruction');
  await button('Send message').click();
  await page.getByText('The turn failed. Check the provider connection, then reuse your instruction to try again.', { exact: true }).waitFor();
  await button('Reuse instruction').click();
  assert.equal(await composer().inputValue(), 'Recover this synthetic instruction');
  assert.equal(requests.length, 2);
  checks.push('503 failure exposes instruction reuse with no execution');
  step = 'responsive';
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const box = await composer().boundingBox();
    responsive.push({ width, overflow, composer: box });
    if ([375, 1440].includes(width)) await page.screenshot({ path: resolve(output, `chat-${width}.png`) });
    assert.equal(overflow, false, `document overflow at ${width}`);
    assert.ok(box && box.x >= 0 && box.x + box.width <= width, `composer outside viewport at ${width}`);
  }
  step = 'provider usage and budget recovery';
  await button('Providers').click();
  rejectUsage = true;
  await button('Refresh usage').click();
  await page.getByRole('alert').filter({ hasText: 'isolated usage unavailable' }).waitFor();
  rejectUsage = false;
  await button('Refresh usage').click();
  await page.getByRole('alert').filter({ hasText: 'isolated usage unavailable' }).waitFor({ state: 'hidden' });
  await button('No budget — set one').click();
  const budget = page.getByRole('textbox', { name: 'Global budget in USD' });
  await budget.fill('15');
  await button('Save').click();
  await page.getByRole('alert').filter({ hasText: 'isolated budget unavailable' }).waitFor();
  assert.equal(await budget.inputValue(), '15');
  assert.equal(await budget.isEnabled(), true);
  rejectBudget = false;
  await button('Save').click();
  await budget.waitFor({ state: 'hidden' });
  checks.push('Usage refresh recovers and failed budget retains editable input for retry');
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, 'e2e-chat.json'), JSON.stringify({ result: 'passed', checks, requests, responsive, unexpected, errors }, null, 2));
  console.log('PASS isolated Chat/Providers journey: ' + checks.length + ' checks, 5 responsive sizes');
} catch (error) {
  writeFileSync(resolve(output, 'e2e-chat.json'), JSON.stringify({ result: 'failed', step, error: error.stack, checks, requests, responsive, unexpected, errors }, null, 2));
  writeFileSync(resolve(output, 'chat-failure.txt'), await page.locator('body').innerText());
  await page.screenshot({ path: resolve(output, 'chat-failure.png') });
  throw error;
} finally { await context.close(); await browser.close(); }
