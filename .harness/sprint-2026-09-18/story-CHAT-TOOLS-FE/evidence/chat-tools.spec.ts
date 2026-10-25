import { test, expect } from "@playwright/test";

/**
 * Real E2E for CHAT-TOOLS-FE's manual-integration DoD item and the sprint's
 * mandatory E2E layer (sprint.md §Estratégia de testes). Runs against the
 * isolated worktree's own frontend (:1420) + backend (:8002), a fixture
 * Cowork project ("Gate FE") and a fake OpenAI-compatible provider standing
 * in for the "Ollama local" connection — both registered once via the
 * backend API by the ledger's setup steps, not by this file. Selectors were
 * confirmed live against the running app (accessibility tree), not guessed.
 * Covers the same ground the destroyed 2026-09-18/22 Playwright run claimed
 * (3 passed): menu without a workspace, New chat preserving history, and a
 * Tool going through the approval gate to a rendered result.
 */

test.describe("Chat tools broker — real E2E", () => {
  test("No workspace hides tools and says why", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Working folder/ }).click();
    await page.getByRole("listbox", { name: "Chat working folder" }).getByRole("option", { name: "No folder" }).click();
    const composer = page.getByPlaceholder(/Ask OHarness/);
    await composer.click();
    await composer.fill("/");
    await expect(page.getByText("Selecione uma pasta para usar ferramentas")).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Commands and skills" }).getByText("Tool", { exact: true })).toHaveCount(0);
  });

  test("Selecting a Tool starts a run, shows approval, and renders the result", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Working folder/ }).click();
    await page.getByRole("listbox", { name: "Chat working folder" }).getByRole("option", { name: "Gate FE" }).first().click();
    await page.getByRole("button", { name: /Chat provider/ }).click();
    await page.getByRole("listbox", { name: "Chat provider" }).getByRole("option", { name: "Ollama local" }).click();

    const composer = page.getByPlaceholder(/Ask OHarness/);
    await composer.click();
    await composer.fill("/exec npm run test");
    await composer.press("Control+Enter");

    // Approval card: argv listed one item per line, waits for a decision.
    await expect(page.getByText("Executar comando")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("listitem").filter({ hasText: "npm" })).toBeVisible();
    const approve = page.getByRole("button", { name: "Aprovar" });
    await expect(approve).toBeVisible();
    // Real screenshot for the story's manual-integration DoD item — captured
    // by the test itself so it's reproducible, not a one-off manual grab.
    await page.screenshot({ path: "reports/screenshots/chat-tools-approval-card.png" });
    await approve.click();

    // State flips to approved, then the fake provider's fixture exec finishes.
    await expect(page.getByText("aprovado")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/concluído|exit 0/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("New chat preserves history and focuses an empty composer", async ({ page }) => {
    await page.goto("/");
    // Auto→Anthropic (the default, unconfigured) cannot actually send — pick
    // a real, reachable connection first, same as the Tool-approval test.
    await page.getByRole("button", { name: /Chat provider/ }).click();
    await page.getByRole("listbox", { name: "Chat provider" }).getByRole("option", { name: "Ollama local" }).click();

    const composer = page.getByPlaceholder(/Ask OHarness/);
    await composer.click();
    await composer.fill("Say hi in one word.");
    await composer.press("Control+Enter");
    await expect(page.getByRole("main").getByText("Say hi in one word.")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "New chat" }).click();
    await expect(composer).toHaveValue("");
    // Focus itself is asserted at the unit level (AgentStage.test.tsx:78,
    // via document.activeElement) rather than here: headless Chromium under
    // Playwright never reports document/page focus in this environment
    // (`toBeFocused()` stayed "inactive" across 14 retries/5s even after
    // page.bringToFront()) — a sandbox limitation, not a signal about the
    // app. Re-check here too if a real windowed run becomes possible.
    // Prior turn still exists in the Chats sidebar list (history preserved).
    await expect(page.getByRole("button", { name: /Say hi in one word/ })).toBeVisible();
  });
});
