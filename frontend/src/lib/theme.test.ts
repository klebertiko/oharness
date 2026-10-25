import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_COLOR, THEME_KEY, appliedTheme, applyTheme, storedTheme } from "./theme";

const script = fs.readFileSync(path.resolve(__dirname, "../../public/theme-init.js"), "utf8");
const runInit = () => new Function(script)();

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  document.head.querySelector('meta[name="theme-color"]')?.remove();
});
afterEach(() => window.localStorage.clear());

describe("theme-init.js (runs before first paint)", () => {
  it("defaults to Graphite", () => {
    runInit();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("applies a saved Ivory choice and sets theme-color and color-scheme to match", () => {
    window.localStorage.setItem(THEME_KEY, "light");
    runInit();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(THEME_COLOR.light);
  });

  it("falls back to Graphite for any other stored value", () => {
    window.localStorage.setItem(THEME_KEY, "purple");
    runInit();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("agrees with theme.ts on the storage key and both colours", () => {
    expect(script).toContain(`"${THEME_KEY}"`);
    expect(script).toContain(THEME_COLOR.dark);
    expect(script).toContain(THEME_COLOR.light);
  });

  it("keeps theme-color equal to --sub-000 of each theme in globals.css", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
    // The value of --sub-000 inside the block that starts at `marker`, found by string search.
    const sub = (marker: string) => {
      const from = css.indexOf(marker);
      const decl = css.indexOf("--sub-000:", from) + "--sub-000:".length;
      return css.slice(decl, css.indexOf(";", decl)).trim();
    };
    expect(THEME_COLOR.dark).toBe(sub(":root {"));
    expect(THEME_COLOR.light).toBe(sub('[data-theme="light"]'));
  });
});

describe("applyTheme", () => {
  it("sets the attribute, color-scheme, theme-color and persists", () => {
    applyTheme("light");
    expect(appliedTheme()).toBe("light");
    expect(storedTheme()).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(THEME_COLOR.light);
    applyTheme("dark");
    expect(appliedTheme()).toBe("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  it("does not throw when storage is blocked", () => {
    const orig = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
    try {
      expect(() => applyTheme("light")).not.toThrow();
      expect(storedTheme()).toBe("dark");
    } finally {
      Object.defineProperty(window, "localStorage", orig);
    }
  });
});
