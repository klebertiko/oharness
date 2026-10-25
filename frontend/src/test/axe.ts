import axe from "axe-core";

/**
 * Runs axe-core on a rendered subtree and returns readable violations. Colour
 * contrast needs real layout and paint, so it is skipped here; it is covered by
 * scripts/check-contrast.mjs (tokens) and scripts/audit-screens.mjs (rendered).
 */
export async function axeViolations(root: Element): Promise<string[]> {
  const result = await axe.run(root, {
    runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"],
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}
