/**
 * Theme persistence. Graphite is the default; Ivory is the person's choice and
 * persists. `public/theme-init.js` applies it before first paint; this module
 * is the runtime side (read, set, toggle) and must agree with that script on
 * the key and on the `theme-color` values, which mirror `--sub-000`.
 */
export type Theme = "dark" | "light";

export const THEME_KEY = "oharness-theme";

export const THEME_COLOR: Record<Theme, string> = {
  dark: "oklch(0.170 0.006 72)",
  light: "oklch(0.965 0.008 82)",
};

export function storedTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** The theme currently applied to the document. */
export function appliedTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Apply a theme to the document and remember it. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", THEME_COLOR[theme]);
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked: the choice lasts for this session */
  }
}
