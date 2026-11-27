// A provider failure reaches the screen as the catalog's sentences: what happened, why, what to do.
// Every sidecar route is stubbed; the run's error text is a canary that must never be shown.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { evidenceDir } from "./e2e-evidence.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = evidenceDir('provider-errors');
mkdirSync(output, { recursive: true });
const fixture = JSON.parse(readFileSync('src/lib/fixtures/ohm-roundtrip.json', 'utf8'));
const base = process.env.OHM_E2E_URL || 'http://127.0.0.1:3000';
const sidecar = 'http://127.0.0.1:18099';
const CANARY = 'CANARY-provider-text-7f3c';
const checks = [], unexpected = [], errors = [], requests = [];
let step = 'startup', frames = [];
const browser = await chromium.launch(process.env.OHM_BROWSER_EXECUTABLE ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true } : { channel: process.env.OHM_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  window.__OH_API__ = 'http://127.0.0.1:18099';
  localStorage.setItem('oh.harnessSession', JSON.stringify({ enabled: false, activeBundleId: null }));
});
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.origin === new URL(base).origin) return route.continue();
  const key = req.method() + ' ' + url.pathname;
  if (url.origin !== sidecar) { unexpected.push(key); return route.abort(); }
  if (key === 'POST /execute/direct') {
    requests.push(req.postDataJSON());
    return route.fulfill({ contentType: 'text/event-stream', body: frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('') });
  }
  const responses = {
    'GET /health': { status: 'ok' }, 'GET /flow/config': { enabled: false }, 'GET /chat/tools/permission': { thread_id: 'qa', mode: 'ask' }, 'GET /bundles/default': fixture,
    'GET /cowork/projects': { projects: [] }, 'GET /harnesses/': [], 'GET /bundles/examples': { examples: [] },
    'GET /providers/clis': { clis: [] }, 'GET /providers/usage-windows': { windows: [{ cli: 'claude', provider: 'anthropic', available: false, reason: 'not-exposed' }, { cli: 'codex', provider: 'openai', available: false, reason: 'unreadable' }, { cli: 'cursor', provider: 'cursor', available: false, reason: 'not-exposed' }] }, 'GET /providers/connections': { connections: [{ id: 'ollama-local', provider: 'ollama', label: 'QA local', enabled: true, residence: 'local', endpoint: 'http://127.0.0.1:11434', secretRef: null, defaultModel: 'qa-default' }] },
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
const start = [
  ['run_start', { run_id: 'isolated-error', order: [{ node_id: 'direct', type: 'agent', label: 'Reply' }] }],
  ['node_start', { node_id: 'direct', adapter: 'ollama', model: 'qa-default' }],
];
try {
  await page.goto(base, { waitUntil: 'networkidle' });

  step = 'overloaded turn in the chat';
  frames = [...start,
    ['node_error', { node_id: 'direct', connection_id: 'ollama-local', provider_failure: 'overload', error: CANARY }],
    ['harness_done', { status: 'error', total_tokens: 0 }]];
  await composer().fill('Synthetic prompt');
  await button('Send message').click();
  const turn = page.getByRole('alert').filter({ hasText: 'The service is overloaded' });
  await turn.waitFor();
  assert.match(await turn.textContent(), /It could not answer right now/);
  assert.match(await turn.textContent(), /Try again in a few minutes/);
  assert.equal((await page.locator('body').textContent()).includes(CANARY), false, 'canary shown in the chat');
  checks.push('Chat turn shows the catalog what/why/action and not the run text');

  step = 'run detail';
  await button('Show run detail').click();
  await page.locator('[data-provider-error="overload"]').first().waitFor();
  checks.push('Run detail shows the catalog row on the failed node');

  step = 'account on the Providers screen';
  await button('Providers').click();
  await page.getByRole('complementary', { name: 'Connections' }).getByRole('button', { name: /QA local/ }).click();
  const account = page.getByRole('alert').filter({ hasText: 'The service is overloaded' });
  await account.waitFor();
  assert.match(await account.textContent(), /Try again in a few minutes/);
  assert.equal((await page.locator('body').textContent()).includes(CANARY), false, 'canary shown on Providers');
  await page.screenshot({ path: resolve(output, 'providers-overload.png') });
  checks.push('Providers detail shows the catalog notice for the failed account');

  step = 'usage limit on a run-level error';
  await page.goto(base, { waitUntil: 'networkidle' }); // a fresh load: the store forgets the overload
  const reset = new Date(Date.now() + 20 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  frames = [...start, ['error', { provider_failure: 'usage_limit', reset_at: reset, error: CANARY }]];
  await composer().fill('Another synthetic prompt');
  await button('Send message').click();
  await page.getByRole('alert').filter({ hasText: 'Subscription limit reached' }).waitFor();
  const other = button('Use another account');
  assert.equal(await other.isDisabled(), true, 'nowhere to go: the button is off');
  await page.getByText('No other account is ready', { exact: true }).first().waitFor();
  assert.equal((await page.locator('body').textContent()).includes(CANARY), false, 'canary shown with the limit');
  await page.screenshot({ path: resolve(output, 'chat-usage-limit.png') });
  checks.push('A run-level usage limit with no connection id raises the banner; Use another account is off with its reason');

  assert.equal(requests.length, 2);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, 'e2e-provider-errors.json'), JSON.stringify({ result: 'passed', checks, unexpected, errors }, null, 2));
  console.log('PASS isolated provider error journey: ' + checks.length + ' checks');
} catch (error) {
  writeFileSync(resolve(output, 'e2e-provider-errors.json'), JSON.stringify({ result: 'failed', step, error: error.stack, checks, unexpected, errors }, null, 2));
  writeFileSync(resolve(output, 'provider-errors-failure.txt'), await page.locator('body').textContent());
  await page.screenshot({ path: resolve(output, 'provider-errors-failure.png') });
  throw error;
} finally { await context.close(); await browser.close(); }
