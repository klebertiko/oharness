/** Click a destination. Below 768px it lives in the sidebar drawer. */
export async function clickDestination(page, name) {
  const button = page.getByRole("button", { name, exact: true }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return;
  }
  const show = page.getByRole("button", { name: /sidebar|barra lateral/i }).first();
  if (await show.isVisible().catch(() => false)) await show.click();
  await button.click();
}
