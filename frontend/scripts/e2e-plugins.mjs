/**
 * The Cordis Plugins destination (ADR 0071), in a real browser against the static export with a stubbed sidecar (scripts/plugins-stub.mjs):
 * the list with state and capabilities, the logs and the four capabilities of a plugin, Export (package and index.json), and the add flow:
 * a live log while it downloads, the review with the host warning, the four capabilities with their effect, one decision for each script
 * (Install stays off until every script is accepted and the warning is confirmed; the install call carries the digest, `do-not-run` and
 * `scripts_accepted`), Do not install (deletes the download, nothing installed), Cancel (DELETE), and a Tarball source with its hash. Then the
 * requests from Nilo (Approve only after the confirmation), "Let Nilo create a plugin" (creator mode on in a thread, nothing sent, no draft)
 * and Descobrir (a fixed unreviewed-list notice, Inspect starts the same review). Both themes, phone and desktop widths, axe at every step.
 * Screenshots go to .e2e-out/plugins (see e2e-evidence.mjs); the 8- captures in Portuguese come from e2e-plugins-captures.mjs.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { settleForAxe } from "./axe-settle.mjs";
import { evidenceDir } from "./e2e-evidence.mjs";
import { API, DIGEST, FETCH_ID, ID, launchOptions, request, routeSidecar, sidecar } from "./plugins-stub.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.OHM_E2E_URL || "http://127.0.0.1:3000";
const out = evidenceDir("plugins");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(launchOptions(require));
let checked = 0;
try {
  for (const theme of ["dark", "light"]) {
    for (const width of [375, 1280]) {
      const where = `${theme}-${width}`;
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce", acceptDownloads: true });
      await context.addInitScript(([t, api]) => {
        try { localStorage.setItem("oharness-theme", t); } catch { /* storage blocked */ }
        window.__OH_API__ = api;
        window.__OH_HUMAN__ = "e2e-human";
      }, [theme, API]);
      const stub = sidecar();
      await routeSidecar(context, base, stub);
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(`${base}/plugins`, { waitUntil: "networkidle" });
      const check = async (label) => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label}: sideways scroll`);
        await settleForAxe(page);
        await page.addScriptTag({ content: axeSource });
        const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).join(", ")}`));
        assert.deepEqual(v, [], `${label}: axe`);
        checked += 1;
      };
      const shot = (name) => page.screenshot({ path: join(out, `${name}-${where}.png`), fullPage: false });

      // The list: host state, isolation, safety notice, plugins with state and capabilities.
      await page.getByRole("list", { name: "Plugins" }).waitFor();
      await page.getByText("Running").first().waitFor();
      await page.getByText("Install only what you trust").first().waitFor();
      await page.getByText("Failed").first().waitFor();
      await check(`list ${where}`);
      await shot("1-list");

      // The details: logs, the four capabilities with their effect, Export with the package and the index.
      await page.getByRole("button", { name: "Details of notes-tool" }).click();
      await page.getByText("[plugin notes-tool] error: left-pad missing").waitFor();
      const detail = page.getByRole("region", { name: "notes-tool details" });
      assert.equal(await detail.getByRole("list", { name: "What each capability does" }).getByRole("listitem").count(), 4, `${where}: four capability rows`);
      await detail.getByText("Blocked", { exact: true }).first().waitFor();
      await detail.getByText("Declared only", { exact: true }).waitFor();
      assert.equal(await detail.getByRole("button", { name: /publish/i }).count(), 0, `${where}: nothing to publish`);
      await check(`detail ${where}`);
      await shot("2-detail");
      for (const name of ["Download package (.tgz)", "Download index (index.json)"]) {
        const [download] = await Promise.all([page.waitForEvent("download"), detail.getByRole("button", { name }).click()]);
        assert.match(download.suggestedFilename(), name.includes("index") ? /^index\.json$/ : /\.tgz$/, `${where}: ${name}`);
      }
      assert.ok(stub.calls.some((c) => c.path === `/cordis/plugins/${ID}/export/index`), `${where}: index export asked`);
      await detail.getByRole("button", { name: "Close details" }).click();

      // Add: the form, the Tarball source, the live log, the review, a decision for each script, then done.
      await page.getByRole("button", { name: "Add plugin" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add a plugin" });
      await dialog.getByRole("radio", { name: "Tarball" }).click();
      await dialog.getByLabel("Address (https) or absolute path of a .tgz").fill("https://example.com/echo-tool-0.3.1.tgz");
      await dialog.getByRole("button", { name: "Check package" }).click();
      await dialog.getByText("A web address needs its hash.").waitFor();
      await dialog.getByLabel("Address (https) or absolute path of a .tgz").fill("\\\\server\\share\\echo.tgz");
      await dialog.getByRole("button", { name: "Check package" }).click();
      await dialog.getByText(/Network paths/).waitFor();
      await check(`tarball ${where}`);
      await shot("3-tarball");
      await dialog.getByRole("radio", { name: "npm" }).click();
      await dialog.getByRole("button", { name: "Check package" }).click();
      await dialog.getByText("Enter the package name.").waitFor();
      await dialog.getByLabel("Package name").fill("echo-tool");
      await dialog.getByLabel("Exact version").fill("0.3.1");
      await check(`add form ${where}`);
      await shot("3-add");

      // Cancel is real: while it runs the log shows the steps and Cancel deletes the download.
      stub.state.hold = true;
      await dialog.getByRole("button", { name: "Check package" }).click();
      const log = dialog.getByRole("log", { name: "Progress" });
      await log.getByText("Checking integrity").waitFor();
      assert.equal(await log.getAttribute("aria-live"), "polite", `${where}: the log is polite`);
      await check(`fetching ${where}`);
      await shot("4-log");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.getByLabel("Package name").waitFor();
      await page.waitForFunction(() => true);
      for (let i = 0; i < 50 && !stub.calls.some((c) => c.method === "DELETE"); i++) await page.waitForTimeout(100);
      assert.ok(stub.calls.some((c) => c.method === "DELETE" && c.path === `/cordis/plugins/fetch/${FETCH_ID}`), `${where}: Cancel deletes the download`);

      // The review: the log stays, the four capabilities, one decision per script.
      stub.state.hold = false;
      await dialog.getByLabel("Package name").fill("echo-tool");
      await dialog.getByLabel("Exact version").fill("0.3.1");
      await dialog.getByRole("button", { name: "Check package" }).click();
      await dialog.getByText("Review before installing").waitFor();
      await dialog.getByText(/Install a plugin only after you have reviewed it/).waitFor();
      await dialog.getByRole("log", { name: "Progress" }).getByText("Review ready").waitFor();
      assert.equal(await dialog.getByRole("list", { name: "What each capability does" }).getByRole("listitem").count(), 4, `${where}: four capability rows in the review`);
      const installButton = dialog.getByRole("button", { name: "Install", exact: true });
      assert.equal(await installButton.isDisabled(), true, `${where}: Install is off before the confirmation`);
      await check(`preview ${where}`);
      await shot("4-preview");
      await dialog.getByRole("checkbox", { name: "I read the warning and trust this plugin" }).check();
      await dialog.getByRole("radiogroup", { name: "Decision for script postinstall" }).getByRole("radio", { name: "Accept without running" }).check();
      assert.equal(await installButton.isDisabled(), true, `${where}: one script still has no decision`);
      await shot("4-scripts");

      // Do not install on a script: the download is deleted and nothing is installed.
      await dialog.getByRole("radiogroup", { name: "Decision for script prepare" }).getByRole("radio", { name: "Do not install" }).check();
      assert.equal(await installButton.isDisabled(), true, `${where}: a declined script keeps Install off`);
      const deletesBefore = stub.calls.filter((c) => c.method === "DELETE").length;
      await dialog.getByRole("button", { name: "Do not install" }).click();
      await dialog.getByText(/Nothing was installed/).waitFor();
      await dialog.getByLabel("Package name").waitFor();
      for (let i = 0; i < 50 && stub.calls.filter((c) => c.method === "DELETE").length === deletesBefore; i++) await page.waitForTimeout(100);
      assert.ok(stub.calls.filter((c) => c.method === "DELETE").length > deletesBefore, `${where}: Do not install deletes the download`);
      assert.equal(stub.calls.some((c) => c.path === "/cordis/plugins/install"), false, `${where}: nothing installed`);
      await check(`declined ${where}`);

      // Again, accepting both scripts: the install carries the list, the log ends in Installing and Done.
      await dialog.getByLabel("Package name").fill("echo-tool");
      await dialog.getByLabel("Exact version").fill("0.3.1");
      await dialog.getByRole("button", { name: "Check package" }).click();
      await dialog.getByText("Review before installing").waitFor();
      await dialog.getByRole("checkbox", { name: "I read the warning and trust this plugin" }).check();
      for (const script of ["postinstall", "prepare"]) await dialog.getByRole("radiogroup", { name: `Decision for script ${script}` }).getByRole("radio", { name: "Accept without running" }).check();
      await installButton.click();
      await dialog.getByText("echo-tool 0.3.1 installed").waitFor();
      const install = stub.calls.find((c) => c.path === "/cordis/plugins/install");
      assert.deepEqual(install.body, { fetch_id: FETCH_ID, accept: true, digest: DIGEST, scripts: "do-not-run", scripts_accepted: ["postinstall", "prepare"] }, `${where}: install body`);
      await dialog.getByRole("log", { name: "Progress" }).getByText("Done").waitFor();
      await check(`done ${where}`);
      await shot("5-done");
      await dialog.getByRole("button", { name: "Activate now" }).click();
      await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="echo-tool active"]')?.getAttribute("aria-checked") === "true");
      await dialog.getByRole("button", { name: "Done" }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await check(`after add ${where}`);

      // Requests from Nilo: the same review, Approve only after the confirmation, then it is in the list.
      const requests = page.getByRole("region", { name: "Requests from Nilo" });
      await requests.getByText("Nilo asks to install hello-tool 0.1.0").scrollIntoViewIfNeeded();
      assert.equal(await requests.getByRole("button", { name: "Approve" }).isDisabled(), true, `${where}: Approve is off before the confirmation`);
      await check(`requests ${where}`);
      await shot("7-requests");
      await requests.getByRole("checkbox", { name: "I read the warning and trust this plugin" }).check();
      await requests.getByRole("button", { name: "Approve" }).click();
      await requests.getByText(/No request waiting/).waitFor();
      assert.ok(stub.calls.some((c) => c.path === `/cordis/requests/${request.id}/approve`), `${where}: approve sent`);
      await page.getByRole("button", { name: "Details of hello-tool" }).waitFor();

      // Let Nilo create a plugin: creator mode on in a thread of its own, a link to the chat, nothing sent, no draft.
      await page.getByRole("button", { name: "Let Nilo create a plugin" }).click();
      await page.getByText("Creator mode on in this conversation").waitFor();
      const turnOn = stub.calls.find((c) => c.method === "POST" && c.path === "/cordis/creator");
      assert.equal(turnOn.body.enabled, true, `${where}: creator mode on`);
      assert.match(turnOn.body.thread_id, /^[A-Za-z0-9_-]{1,64}$/, `${where}: it names a thread`);
      assert.equal(await page.getByLabel("Draft for the chat").count(), 0, `${where}: no copy-paste draft any more`);
      assert.equal(stub.calls.some((c) => c.path.startsWith("/execute")), false, `${where}: nothing is sent to the chat`);
      await page.getByText("Creator mode on in this conversation").scrollIntoViewIfNeeded();
      await check(`creator ${where}`);
      await shot("7-creator");

      // Descobrir: the notice is fixed at the top, the index text is never markup, Inspect starts the same review.
      await page.getByRole("radio", { name: "Discover" }).click();
      const notice = page.getByText("Unreviewed list: indexes are third-party; check the source before installing.");
      await notice.waitFor();
      await page.getByLabel("Index address (https)").fill("https://example.com/index.json");
      await page.getByRole("button", { name: "Load index" }).click();
      const listed = page.getByRole("list", { name: "Plugins in the index" });
      await listed.getByText("<img src=x onerror=alert(1)> Keeps notes.").waitFor();
      assert.equal(await page.locator("main img, [role=list] img").count(), 0, `${where}: index text is not markup`);
      assert.deepEqual(stub.calls.find((c) => c.path === "/cordis/index/fetch").body, { url: "https://example.com/index.json" }, `${where}: index url`);
      assert.equal(await listed.getByRole("button", { name: /^Install/ }).count(), 0, `${where}: Inspect, never Install, in the list`);
      await page.evaluate(() => document.querySelector("[data-discover-notice]")?.closest("div.overflow-auto")?.scrollTo(0, 400));
      assert.equal(await notice.isVisible(), true, `${where}: the notice stays at the top`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("[data-discover-notice]")).position), "sticky", `${where}: sticky`);
      await check(`discover ${where}`);
      await shot("7-discover");
      await listed.getByRole("button", { name: "Inspect git-thing" }).click();
      const inspected = page.getByRole("dialog", { name: "Add a plugin" });
      await inspected.getByText("Review before installing").waitFor();
      assert.equal(await inspected.getByLabel("Package name").count(), 0, `${where}: Inspect skips the form`);
      const started = stub.calls.filter((c) => c.method === "POST" && c.path === "/cordis/plugins/fetch").at(-1);
      assert.deepEqual(started.body, { kind: "github", spec: "bo/thing", commit: "c".repeat(40), subdir: "pkg", live: true }, `${where}: the fetch starts with the entry's source`);
      await check(`discover inspect ${where}`);
      await shot("7-discover-add");
      await context.close();
    }
  }
  console.log(`Plugins: ${checked} axe checks passed; screenshots in ${out}.`);
} finally {
  await browser.close();
}
