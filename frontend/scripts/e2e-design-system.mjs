/**
 * The design-system catalogue (/dev/design-system) in a real browser, in Graphite and Ivory. Proves,
 * against the static export, that every primitive renders and passes axe (WCAG 2.2 AA + best practice,
 * colour contrast included) in each of these states:
 *
 *   - at rest, with the disabled and error variants the page always shows;
 *   - keyboard focus on a control (the focus ring is painted);
 *   - Menu, Popover, Tooltip and the Select list open;
 *   - info, warn and fault toasts on screen;
 *   - Dialog and Sheet open (and Escape closes them, focus back on the opener).
 *
 * A screenshot of each state goes to .e2e-out/design-system/ (uploaded by CI as an artifact).
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { settleForAxe } from "./axe-settle.mjs";
import { evidenceDir } from "./e2e-evidence.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
// The production export has no /dev (scripts/strip-dev-routes.mjs; e2e-shell proves the 404). This script
// needs a build made with NEXT_PUBLIC_OH_DEV_ROUTES=1; CI runs one for it and sets OH_E2E_REQUIRE_DEV=1 so a
// missing page fails instead of skipping.
const probe = await fetch(`${base}/dev/design-system`);
if (probe.status === 404) {
  if (process.env.OH_E2E_REQUIRE_DEV === "1") {
    console.error("FAIL design system: /dev/design-system is 404 but OH_E2E_REQUIRE_DEV=1 (build with NEXT_PUBLIC_OH_DEV_ROUTES=1).");
    process.exit(1);
  }
  console.log("SKIP design system: this export has no /dev (a production build). Build with NEXT_PUBLIC_OH_DEV_ROUTES=1 to run it.");
  process.exit(0);
}
const out = evidenceDir("design-system");
mkdirSync(out, { recursive: true });

const launch = process.env.OHM_BROWSER_EXECUTABLE
  ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true }
  : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
const browser = await chromium.launch(launch);

/**
 * axe on the whole page, or, for a modal state, on the open overlay only: a modal (Select list, Dialog,
 * Sheet) hides the rest of the page from assistive tech and traps focus, so the page behind it is not
 * what a user meets. Page-level rules (one main, one h1, everything in a landmark) mean nothing inside
 * that subtree and are the only ones left out there.
 */
async function axe(page, label, modal) {
  await settleForAxe(page);
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async (scope) => {
    const context = scope ? { include: [[scope]] } : document;
    const rules = scope ? { region: { enabled: false }, "landmark-one-main": { enabled: false }, "page-has-heading-one": { enabled: false } } : {};
    const result = await window.axe.run(context, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"], rules });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  }, modal ?? null);
  assert.deepEqual(violations, [], `${label}: axe`);
}

async function shot(page, name, fullPage = false) {
  await settleForAxe(page);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage });
}

let states = 0;
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
    await context.addInitScript((t) => {
      try {
        localStorage.setItem("oharness-theme", t);
      } catch {
        /* storage blocked */
      }
    }, theme);
    // The catalogue needs no sidecar: anything that leaves the page's origin is refused.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.fulfill({ status: 404, body: "{}" }),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`${base}/dev/design-system`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Design system" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme, `${theme}: theme applied`);
    const at = (state) => `${theme} ${state}`;

    // At rest: disabled and error variants are always on the page.
    assert.equal(await page.getByRole("button", { name: "Run", exact: true }).isDisabled(), true, at("disabled button"));
    assert.equal(await page.getByLabel("Endpoint").getAttribute("aria-invalid"), "true", at("input error"));
    assert.equal(await page.getByRole("combobox", { name: "Unavailable" }).isDisabled(), true, at("disabled select"));
    await axe(page, at("rest"));
    await shot(page, `${theme}-rest`, true);
    states += 1;

    // Keyboard focus paints a ring.
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "Save", exact: true }).focus();
    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { name: document.activeElement?.textContent, outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0, shadow: style.boxShadow !== "none" };
    });
    assert.equal(ring.name, "Save", at("focus lands on Save"));
    assert.ok(ring.outline || ring.shadow, at("focus ring is painted"));
    await axe(page, at("focus"));
    await page.getByRole("button", { name: "Save", exact: true }).screenshot({ path: join(out, `${theme}-focus.png`) });
    states += 1;

    // Menu open from the keyboard.
    const actions = page.getByRole("button", { name: "Actions", exact: true });
    await actions.focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("menu").waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "menuitem", at("menu focus"));
    await axe(page, at("menu open"));
    await shot(page, `${theme}-menu`);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("menu").count(), 0, at("menu closes on Escape"));
    states += 1;

    // Popover open.
    const details = page.getByRole("button", { name: "Details", exact: true });
    await details.click();
    await page.getByRole("dialog", { name: "About this row" }).waitFor();
    await axe(page, at("popover open"));
    await shot(page, `${theme}-popover`);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog", { name: "About this row" }).count(), 0, at("popover closes on Escape"));
    assert.equal(await details.evaluate((node) => node === document.activeElement), true, at("popover gives focus back"));
    states += 1;

    // Tooltip open on keyboard focus: a real Tab from the control before it.
    // Bring it into view first: a tooltip closes when its container scrolls, and focus would scroll it.
    await page.getByRole("button", { name: "Undo", exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.getByRole("button", { name: "New chat", exact: true }).first().focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Undo", at("Tab reaches Undo"));
    await page.locator("[role=tooltip]").waitFor({ state: "attached" });
    await page.locator("[data-radix-popper-content-wrapper]").waitFor();
    await axe(page, at("tooltip open"));
    await shot(page, `${theme}-tooltip`);
    await page.keyboard.press("Escape");
    states += 1;

    // Select list open.
    await page.getByRole("combobox", { name: "Model" }).click();
    await page.getByRole("listbox").waitFor();
    await axe(page, at("select open"), "[role=listbox]");
    await shot(page, `${theme}-select`);
    await page.getByRole("option", { name: "Charlie" }).click();
    assert.match(await page.getByRole("combobox", { name: "Model" }).textContent(), /Charlie/, at("select changes value"));
    states += 1;

    // Toasts: info, warn and fault at once.
    for (const name of ["Info toast", "Warn toast", "Fault toast"]) await page.getByRole("button", { name }).click();
    await page.getByRole("region", { name: "Notifications" }).getByRole("button", { name: "Dismiss notification" }).nth(2).waitFor();
    await axe(page, at("toasts"));
    await shot(page, `${theme}-toasts`);
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Dismiss notification" }).first().click();
    states += 1;

    // Dialog and sheet open; Escape closes each and focus goes back.
    for (const [opener, title] of [["Open dialog", "Rename harness"], ["Open sheet", "Keyboard map"]]) {
      const button = page.getByRole("button", { name: opener });
      await button.click();
      await page.getByRole("dialog", { name: title }).waitFor();
      await axe(page, at(`${title} open`), "[role=dialog]");
      await shot(page, `${theme}-${opener.split(" ")[1]}`);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: title }).waitFor({ state: "detached" });
      // Focus comes back once the closing animation has unmounted the dialog.
      const handle = await button.elementHandle();
      const back = await page.waitForFunction((node) => node === document.activeElement, handle, { timeout: 3000 }).then(() => true, () => false);
      assert.equal(back, true, at(`${title} gives focus back`));
      states += 1;
    }

    assert.deepEqual(errors, [], at("page errors"));
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`PASS design system: ${states} states across Graphite and Ivory, axe clean, captures in ${out}`);
