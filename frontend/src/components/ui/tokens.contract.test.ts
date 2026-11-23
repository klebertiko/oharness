import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GROUNDS, LARGE, MARK_GROUNDS, MARKS, TEXT, declarations, pairRatio, readCss, themeVars } from "./contrastPairs";

const UI = path.resolve(__dirname);

/**
 * :root colours that are deliberately not Tailwind utilities: they are read only
 * through var() by CSS that needs them (scrollbars, shadows, focus ring...).
 * Adding a colour here is a decision; a colour missing from both is a bug.
 */
const RAW_ONLY = new Set<string>([
  // Palette steps: components use the semantic fg-* / ink that alias them, never the step itself.
  "--ink-primary",
  "--ink-secondary",
  "--ink-tertiary",
  // Nilo's pixel art: painted through var() by the brand grid, not a UI colour.
  "--nilo-body",
  "--nilo-eye",
  "--nilo-pupil",
  "--nilo-beak",
  "--nilo-rim",
  "--nilo-screen",
  "--nilo-desk",
  "--nilo-code",
  // Read through var() inside a box-shadow and a scrim.
  "--surface-highlight",
  "--overlay-backdrop",
]);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe("design tokens", () => {
  const css = readCss();

  it("keeps every @theme reference defined on :root", () => {
    const theme = css.slice(css.indexOf("@theme"), css.indexOf("}", css.indexOf("@theme")));
    const root = declarations(css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {"))));
    const missing = [...theme.matchAll(/var\(--([\w-]+)\)/g)].map((match) => match[1]).filter((name) => !( `--${name}` in root));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("exposes every :root colour as a utility (the other direction)", () => {
    const theme = css.slice(css.indexOf("@theme"), css.indexOf("}", css.indexOf("@theme")));
    const root = declarations(css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {"))));
    const isColour = (name: string, seen = new Set<string>()): boolean => {
      const raw = root[name] ?? "";
      if (/^(oklch|color-mix)\(/.test(raw)) return true;
      const alias = /^var\((--[\w-]+)\)$/.exec(raw);
      if (!alias || seen.has(alias[1])) return false;
      seen.add(alias[1]);
      return isColour(alias[1], seen);
    };
    const missing = Object.keys(root)
      .filter((name) => isColour(name))
      .filter((name) => !theme.includes(`--color-${name.slice(2)}: var(${name});`))
      .filter((name) => !RAW_ONLY.has(name));
    expect(missing).toEqual([]);
  });

  it("gives compact and comfortable their own control, pad, gap and icon steps", () => {
    const root = declarations(css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {"))));
    const compact = declarations(css.slice(css.indexOf(':root[data-density="compact"]'), css.indexOf("}", css.indexOf(':root[data-density="compact"]'))));
    expect(root["--control-sm"]).toBe("28px");
    expect(root["--control-md"]).toBe("32px");
    expect(root["--control-lg"]).toBe("36px");
    expect(root["--icon"]).toBe("18px");
    expect(root["--pad-1"]).toBe("6px");
    expect(root["--gap-1"]).toBe("6px");
    expect(compact["--control-sm"]).toBe("24px");
    expect(compact["--control-md"]).toBe("28px");
    expect(compact["--control-lg"]).toBe("32px");
    expect(compact["--icon"]).toBe("16px");
    expect(compact["--pad-1"]).toBe("4px");
    expect(compact["--gap-5"]).toBe("24px");
    expect(root["--oh-scale"]).toBe("1");
  });

  it("copies the Ivory values onto the system theme", () => {
    const light = declarations(css.slice(css.indexOf('[data-theme="light"] {'), css.indexOf("}", css.indexOf('[data-theme="light"] {'))));
    const systemAt = css.indexOf(':root[data-theme="system"] {', css.indexOf("prefers-color-scheme: light"));
    const system = declarations(css.slice(systemAt, css.indexOf("}", systemAt)));
    for (const [name, value] of Object.entries(light)) {
      if (name === "color-scheme") continue;
      expect(system[name], name).toBe(value);
    }
  });

  it("passes text, large and mark contrast in both themes", () => {
    const failures: string[] = [];
    for (const theme of ["dark", "light"] as const) {
      const vars = themeVars(css, theme);
      for (const fg of TEXT) for (const bg of GROUNDS) {
        const ratio = pairRatio(fg, bg, vars);
        if (ratio < 4.5) failures.push(`${theme} ${fg} on ${bg} ${ratio.toFixed(2)}`);
      }
      for (const fg of LARGE) for (const bg of GROUNDS) {
        const ratio = pairRatio(fg, bg, vars);
        if (ratio < 3) failures.push(`${theme} large ${fg} on ${bg} ${ratio.toFixed(2)}`);
      }
      for (const fg of MARKS) for (const bg of MARK_GROUNDS) {
        const ratio = pairRatio(fg, bg, vars);
        if (ratio < 3) failures.push(`${theme} mark ${fg} on ${bg} ${ratio.toFixed(2)}`);
      }
      // Tooltip paints the page ground as text on fg-1.
      const tip = pairRatio("bg-app", "fg-1", vars);
      if (tip < 4.5) failures.push(`${theme} tooltip bg-app on fg-1 ${tip.toFixed(2)}`);
      const edge = pairRatio("border-2", "bg-app", vars);
      if (edge < 3) failures.push(`${theme} border-2 on bg-app ${edge.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });

  it("has no arbitrary pixel values in ui/", () => {
    const hits = walk(UI)
      .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
      .flatMap((file) =>
        fs
          .readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, index) => (/\[[^\]]*\d+(?:\.\d+)?px/.test(line) ? [`${path.relative(UI, file)}:${index + 1}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});
