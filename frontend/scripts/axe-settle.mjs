/**
 * Call before `axe.run`: axe reads computed colours, so a transition or animation still running
 * (a theme switch, a popover fading in, a hover) can report a contrast that is never on screen
 * once it settles. This switches transitions and animations off for the page and waits two
 * frames so the styles it measures are the final ones.
 */
export async function settleForAxe(page) {
  await page.evaluate(() => {
    if (document.getElementById("oh-axe-settle")) return;
    const style = document.createElement("style");
    style.id = "oh-axe-settle";
    style.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
    document.head.appendChild(style);
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
