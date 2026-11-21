/**
 * Theme persistence. System is the default and follows the OS. Graphite and
 * Ivory are explicit choices and persist. `public/theme-init.js` applies the
 * choice before first paint; this module is the runtime side and must agree
 * with that script on the key and on the `theme-color` values, which mirror
 * `--sub-000`.
 */
export type Theme = "dark" | "light" | "system";

export const THEME_KEY = "oharness-theme";

export const THEME_COLOR: Record<"dark" | "light", string> = {
  dark: "oklch(0.170 0.006 72)",
  light: "oklch(0.965 0.008 82)",
};

const isTheme = (value: string | null): value is Theme => value === "dark" || value === "light" || value === "system";

export function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** The theme currently applied to the document. */
export function appliedTheme(): Theme {
  const value = document.documentElement.dataset.theme ?? null;
  return isTheme(value) ? value : "system";
}

function themeColor(theme: Theme): string {
  if (theme === "light") return THEME_COLOR.light;
  if (theme === "dark") return THEME_COLOR.dark;
  const light = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
  return light ? THEME_COLOR.light : THEME_COLOR.dark;
}

/** Apply a theme to the document and remember it. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === "system" ? "light dark" : theme;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", themeColor(theme));
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked: the choice lasts for this session */
  }
}
