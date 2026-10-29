/**
 * The Providers journey in a real browser (static export, stubbed sidecar, synthetic data; run-e2e.mjs
 * serves out/ and sets OHM_E2E_URL). Proves, for the redesigned screen (ADR 0035):
 *
 *   - add a connection: paste a key, it goes to the sidecar once, the field empties and the key is
 *     never in the page afterwards (ADR 0001); the connection reads Verified;
 *   - test: a rejected key is classified (ADR 0013) and its one action is Replace key, which focuses the field;
 *   - a local Ollama whose default model is not pulled offers the pull command and copies it;
 *   - remove a key: confirmation first, Cancel focused, Escape cancels, the sidecar is asked once;
 *   - never more than one primary button in view (asserted in the states above, in the axe loop and on the narrow detail);
 *   - the sidecar down is a state of its own (Retry, no false "Not connected") and recovers;
 *   - axe finds nothing in both themes and in pt-BR; nothing scrolls sideways at 320, 375, 768, 1280;
 *   - narrow: the list is the screen and a connection opens over it, Back returns;
 *   - touch (pointer: coarse): every control is 44px or taller (ADR 0033);
 *   - keyboard: a list row opens with Enter, Tab reaches the key field, the focus ring is a solid 2px;
 *   - reduced motion: nothing animates (with a positive control: it animates when motion is allowed);
 *   - every state logs no page error, no console error and no request outside the stubbed sidecar.
 *
 * Set OHM_E2E_SHOTS=<dir> to keep a screenshot of each state.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const API = "http://127.0.0.1:18099";
const shots = process.env.OHM_E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const fixture = JSON.parse(readFileSync("src/lib/fixtures/ohm-roundtrip.json", "utf8"));
// Low-entropy on purpose: it only has to start like an OpenRouter key and be recognisable in the page.
const SECRET = `sk-or-${"e2e-".repeat(6)}`;
const row = (id, provider, label, residence, endpoint, extra = {}) => ({ id, provider, label, residence, endpoint, enabled: false, secretRef: null, defaultModel: "", ...extra });
const openrouterOn = () => row("openrouter", "openrouter", "OpenRouter", "cloud", "https://openrouter.ai/api/v1", { enabled: true, secretRef: "oharness/openrouter", defaultModel: "openai/gpt-4o" });
const usage = { totalTokens: 0, totalCostUsd: 0, unpricedTokens: 0, budget: { limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" }, byConnection: [], bySource: [] };
const live = (models, detail = "Reachable.") => ({ ok: true, health: "live", detail, latencyMs: 120, facts: [], models });

/** A sidecar that remembers: rows, the keys it was sent, and what each probe answers. */
function sidecar(rows, probes = {}) {
  const s = { rows, probes, keysSent: [], deleted: [], down: false, hang: false, probeCalls: 0 };
  s.handle = (method, path, body) => {
    if (s.down) return { status: 503, body: {} };
    const key = `${method} ${path}`;
    if (key === "GET /providers/connections") return { body: { connections: s.rows } };
    if (key === "GET /usage/summary") return { body: usage };
    if (key === "GET /bundles/default") return { body: fixture };
    if (key === "GET /health") return { body: { status: "ok" } };
    if (key === "GET /harnesses/") return { body: [] };
    if (key === "GET /cowork/projects") return { body: { projects: [] } };
    if (key === "GET /bundles/examples") return { body: { examples: [] } };
    if (key === "POST /providers/connections") return { body: {} };
    let m = /^PUT \/providers\/connections\/([^/]+)$/.exec(key);
    if (m) {
      const r = s.rows.find((x) => x.id === m[1]);
      if (r) Object.assign(r, body);
      return { body: {} };
    }
    m = /^POST \/providers\/([^/]+)\/secret$/.exec(key);
    if (m) {
      s.keysSent.push(body.key);
      const r = s.rows.find((x) => x.id === m[1]);
      if (r) r.secretRef = `oharness/${m[1]}`;
      return { body: { secretRef: `oharness/${m[1]}` } };
    }
    m = /^DELETE \/providers\/([^/]+)\/secret$/.exec(key);
    if (m) {
      s.deleted.push(m[1]);
      const r = s.rows.find((x) => x.id === m[1]);
      if (r) r.secretRef = null;
      return { body: {} };
    }
    m = /^POST \/providers\/([^/]+)\/probe$/.exec(key);
    if (m) {
      s.probeCalls += 1;
      if (s.hang) return { hang: true };
      return { body: s.probes[m[1]] ?? live([]) };
    }
    return { status: 404, body: { detail: "not stubbed" } };
  };
  return s;
}

const launch = process.env.OHM_BROWSER_EXECUTABLE
  ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true }
  : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
const browser = await chromium.launch(launch);
const checks = [];
const ok = (label) => checks.push(label);

async function session(sc, { theme = "dark", locale = "en", viewport = { width: 1280, height: 860 }, touch = false, reduced = false } = {}) {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: "block",
    hasTouch: touch,
    isMobile: touch,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await context.addInitScript(([t, l, api]) => {
    try {
      localStorage.setItem("oharness-theme", t);
      localStorage.setItem("oharness-locale", l);
    } catch { /* storage blocked */ }
    window.__OH_API__ = api;
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text) => void window.__copied.push(text) }, configurable: true });
  }, [theme, locale, API]);
  const unexpected = [];
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === new URL(base).origin) return route.continue();
    if (url.origin !== API) {
      unexpected.push(url.origin);
      return route.abort();
    }
    const res = sc.handle(req.method(), url.pathname, req.postDataJSON?.() ?? {});
    if (res.hang) return; // never answers: the screen stays in "Testing"
    return route.fulfill({ status: res.status ?? 200, contentType: "application/json", body: JSON.stringify(res.body) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() === 404) errors.push(`404 ${new URL(r.url()).pathname}`);
  });
  page.on("console", (m) => {
    // A stubbed sidecar that is down answers 503 on purpose; every other console error counts.
    if (m.type() === "error" && !/status of 404/.test(m.text()) && !(sc.down && /status of 503/.test(m.text()))) errors.push(m.text().slice(0, 160));
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Providers", exact: true }).first().click();
  await page.getByRole("heading", { level: 1, name: /^(Providers)$/ }).waitFor({ state: "attached" });
  return { context, page, errors, unexpected, sc };
}

/** Closes a session after checking it logged no page error, console error or request outside the stubbed sidecar. */
async function finish({ context, errors, unexpected }) {
  assert.deepEqual(errors, [], "page or console errors");
  assert.deepEqual(unexpected, [], "requests outside the stubbed sidecar");
  await context.close();
}

const list = (page) => page.getByRole("complementary");
const openRow = (page, name) => list(page).getByRole("button", { name }).click();
const primaries = (page) => page.evaluate(() => [...document.querySelectorAll("main button")].filter((b) => /(^|\s)bg-signal(\s|$)/.test(b.className) && b.getBoundingClientRect().width > 0 && !b.disabled).map((b) => b.textContent.trim()));
const shot = async (page, name) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};
const axe = async (page) => {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] });
    return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  });
};
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  /* 1 · Add a connection: paste, store once, never echo. */
  {
    const sc = sidecar([row("openrouter", "openrouter", "OpenRouter", "cloud", "https://openrouter.ai/api/v1", { defaultModel: "openai/gpt-4o" })], { openrouter: live(["openai/gpt-4o", "qwen/qwen3-max"], "Reachable. 2 models offered.") });
    const S = await session(sc);
    const { page } = S;
    await openRow(page, "OpenRouter");
    await page.getByRole("heading", { level: 2, name: "OpenRouter" }).waitFor();
    await page.getByText("Nothing is connected yet").waitFor();
    assert.deepEqual(await primaries(page), [], "no key yet: the key field is the action, so no header primary besides Save key");
    const field = page.getByLabel("Paste your OpenRouter key");
    assert.equal(await field.getAttribute("type"), "password");
    await shot(page, "providers-add-key");
    await field.fill(SECRET);
    assert.deepEqual(await primaries(page), ["Save key"], "exactly one primary while a key is being added");
    await page.getByRole("button", { name: "Save key" }).click();
    await page.getByText("Verified", { exact: true }).first().waitFor();
    assert.deepEqual(sc.keysSent, [SECRET], "the key reached the sidecar once");
    assert.equal((await page.content()).includes(SECRET), false, "the key is not in the markup");
    const held = await page.evaluate((secret) => ({
      fields: [...document.querySelectorAll("input,textarea")].filter((e) => e.value.includes(secret)).length,
      text: document.body.innerText.includes(secret),
      storage: JSON.stringify({ ...localStorage, ...sessionStorage }).includes(secret),
    }), SECRET);
    assert.deepEqual(held, { fields: 0, text: false, storage: false }, "the key is in no field, no text and no storage");
    assert.equal(await page.getByLabel("Paste your OpenRouter key").count(), 0, "the entry field is gone once the key is sealed");
    assert.equal(await page.getByRole("button", { name: "Replace", exact: true }).isVisible(), true);
    assert.deepEqual(await primaries(page), [], "a connected connection has no primary action");
    await shot(page, "providers-connected");
    ok("add a connection: key stored once, field emptied, key never in the page, Verified");
    await finish(S);
  }

  /* 2 · A rejected key is classified; its one action is Replace key. */
  {
    const sc = sidecar([openrouterOn()], {
      openrouter: { ok: false, health: "fault", detail: "401 unauthorized — the key was rejected.", latencyMs: 80, facts: [] },
    });
    const S = await session(sc);
    const { page } = S;
    await openRow(page, "OpenRouter");
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await page.getByText("Key rejected").first().waitFor();
    assert.deepEqual(await primaries(page), ["Replace key"]);
    await shot(page, "providers-key-rejected");
    await page.getByRole("button", { name: "Replace key", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Paste your OpenRouter key");
    ok("test: a rejected key is classified, one primary (Replace key), and it focuses the key field");
    await finish(S);
  }

  /* 3 · Ollama with a default model that is not pulled. */
  {
    const sc = sidecar([row("ollama-local", "ollama", "Ollama local", "local", "http://127.0.0.1:11434/v1", { enabled: true, defaultModel: "llama3.2" })], {
      "ollama-local": live(["qwen3:8b"], "Reachable. 1 model."),
    });
    const S = await session(sc);
    const { page } = S;
    await openRow(page, "Ollama local");
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await page.getByText("Model not pulled").first().waitFor();
    assert.deepEqual(await primaries(page), ["Copy `ollama pull llama3.2`"]);
    await page.getByRole("button", { name: "Test again", exact: true }).waitFor();
    await shot(page, "providers-model-not-pulled");
    await page.getByRole("button", { name: "Copy `ollama pull llama3.2`" }).click();
    await page.getByRole("button", { name: "Copied" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__copied), ["ollama pull llama3.2"]);
    ok("Ollama not pulled: one primary copies `ollama pull llama3.2`, then Test again sits beside it");
    await finish(S);
  }

  /* 4 · Remove a key: confirm first. */
  {
    const sc = sidecar([openrouterOn()]);
    const S = await session(sc);
    const { page } = S;
    await openRow(page, "OpenRouter");
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Cancel", "Cancel has focus");
    assert.deepEqual(sc.deleted, []);
    assert.deepEqual(await primaries(page), [], "the confirmation adds no primary");
    await shot(page, "providers-remove-confirm");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Remove key", exact: true }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("button", { name: "Remove key", exact: true }).click();
    await page.getByLabel("Paste your OpenRouter key").waitFor();
    assert.deepEqual(sc.deleted, ["openrouter"]);
    ok("remove a key: confirmation, Cancel focused, Escape cancels, the sidecar is asked once");
    await finish(S);
  }

  /* 5 · Sidecar down is its own state, and recovers. */
  {
    const sc = sidecar([openrouterOn()]);
    sc.down = true;
    const S = await session(sc);
    const { page } = S;
    await page.getByText("Couldn't reach the sidecar").waitFor();
    assert.equal(await page.getByText("Not connected").count(), 0, "offline never claims 'Not connected'");
    assert.deepEqual(await primaries(page), [], "offline has no primary besides Retry, which is secondary");
    await shot(page, "providers-offline");
    sc.down = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await page.getByText("Couldn't reach the sidecar").waitFor({ state: "detached" });
    await list(page).getByText("Ready", { exact: true }).waitFor();
    ok("sidecar down: its own notice with Retry, no false state, and the list returns on Retry");
    await finish(S);
  }

  /* 6 · axe in both themes and in pt-BR; no sideways scroll at four widths. */
  for (const [theme, locale] of [["dark", "en"], ["light", "en"], ["dark", "pt-BR"], ["light", "pt-BR"]]) {
    const sc = sidecar([openrouterOn(), row("ollama-local", "ollama", "Ollama local", "local", "http://127.0.0.1:11434/v1", { enabled: true, defaultModel: "llama3.2" })], {
      openrouter: { ok: false, health: "fault", detail: "401 unauthorized — the key was rejected.", latencyMs: 80, facts: [] },
    });
    for (const width of [320, 375, 768, 1280]) {
      const S = await session(sc, { theme, locale, viewport: { width, height: 860 } });
      const { page } = S;
      await openRow(page, "OpenRouter");
      const probe = locale === "pt-BR" ? "Testar" : "Test";
      await page.getByRole("button", { name: probe, exact: true }).first().click();
      await page.getByText(locale === "pt-BR" ? "Chave recusada" : "Key rejected").locator("visible=true").first().waitFor();
      assert.equal(await noSideScroll(page), true, `side scroll at ${width} (${theme}, ${locale})`);
      const violations = await axe(page);
      assert.deepEqual(violations, [], `axe ${theme} ${locale} ${width}`);
      assert.ok((await primaries(page)).length <= 1, `at most one primary at ${width} (${theme}, ${locale})`);
      if (locale === "pt-BR") assert.equal(await page.getByText("Conexão", { exact: true }).first().isVisible(), true);
      await finish(S);
    }
  }
  ok("axe clean in Graphite and Ivory, en and pt-BR, at 320, 375, 768 and 1280; no sideways scroll");

  /* 7 · Narrow: the list is the screen; a connection opens over it; Back returns. */
  {
    const sc = sidecar([openrouterOn()]);
    const S = await session(sc, { viewport: { width: 375, height: 800 } });
    const { page } = S;
    await list(page).getByRole("button", { name: /^OpenRouter/ }).waitFor();
    assert.equal(await page.getByRole("heading", { level: 2, name: "OpenRouter" }).isVisible(), false, "the list comes first on a narrow stage");
    await shot(page, "providers-narrow-list");
    await openRow(page, "OpenRouter");
    await page.getByRole("heading", { level: 2, name: "OpenRouter" }).waitFor();
    assert.ok((await primaries(page)).length <= 1, "at most one primary on the narrow detail");
    await shot(page, "providers-narrow-detail");
    await page.getByRole("button", { name: "Providers", exact: true }).last().click();
    await list(page).getByRole("button", { name: /^OpenRouter/ }).waitFor();
    ok("narrow: the list is the screen, a connection opens over it, Back returns to the list");
    await finish(S);
  }

  /* 8 · Touch: 44px targets. */
  {
    const sc = sidecar([openrouterOn()]);
    const S = await session(sc, { viewport: { width: 375, height: 800 }, touch: true });
    const { page } = S;
    assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), true);
    const small = async () =>
      page.evaluate(() =>
        [...document.querySelectorAll("main button, main input, main a[href]")]
          .filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden")
          .map((e) => ({ n: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) }))
          .filter((x) => x.h < 44),
      );
    assert.deepEqual(await small(), [], "list targets under 44px on touch");
    await openRow(page, "OpenRouter");
    await page.getByRole("heading", { level: 2, name: "OpenRouter" }).waitFor();
    assert.deepEqual(await small(), [], "detail targets under 44px on touch");
    ok("touch (pointer: coarse): every button, field and link on the screen is 44px or taller");
    await finish(S);
  }

  /* 9 · Keyboard: Enter opens a row, Tab reaches the key field, the ring is a solid 2px. */
  {
    const sc = sidecar([]);
    const S = await session(sc);
    const { page } = S;
    await list(page).getByRole("button", { name: /^OpenRouter/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { level: 2, name: "OpenRouter" }).waitFor();
    let reached = false;
    for (let i = 0; i < 30 && !reached; i += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Paste your OpenRouter key");
    }
    assert.equal(reached, true, "Tab reaches the key field");
    await page.keyboard.press("Tab"); // Save key (disabled) is skipped; the next stop is a real control
    const ring = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { style: s.outlineStyle, width: s.outlineWidth };
    });
    assert.equal(ring.style, "solid");
    assert.equal(ring.width, "2px");
    ok("keyboard: Enter opens a row, Tab reaches the key field, focus ring is solid 2px");
    await finish(S);
  }

  /* 10 · Reduced motion: the busy mark is still; with motion allowed the same mark does animate. */
  for (const reduced of [false, true]) {
    const sc = sidecar([openrouterOn()]);
    sc.hang = true;
    const S = await session(sc, { reduced });
    const { page } = S;
    await openRow(page, "OpenRouter");
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await page.getByText("Checking connection").first().waitFor();
    if (reduced) await shot(page, "providers-testing");
    const animated = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((e) => getComputedStyle(e).animationName !== "none").length);
    if (reduced) assert.equal(animated, 0, "nothing animates under prefers-reduced-motion");
    else assert.ok(animated > 0, "the busy mark does animate when motion is allowed (so the reduced check is not vacuous)");
    await finish(S);
  }
  ok("reduced motion: nothing on the screen animates; the same state animates when motion is allowed");
} finally {
  await browser.close();
}
console.log(`PASS Providers journey: ${checks.length} checks\n - ${checks.join("\n - ")}`);
