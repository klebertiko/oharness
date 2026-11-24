/**
 * Where an open overlay (menu, tooltip, select list) is mounted: the landmark or
 * dialog around its trigger, so landmark navigation finds it and a modal dialog
 * neither hides it nor traps focus away from it. The page body only when there
 * is none.
 */
export function portalHost(trigger: HTMLElement | null): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  return (
    trigger?.closest<HTMLElement>(
      "[role='dialog'], [role='alertdialog'], dialog, main, [role='main'], nav, aside, header, footer, section[aria-label], section[aria-labelledby], [role='region']",
    ) ?? document.body
  );
}
