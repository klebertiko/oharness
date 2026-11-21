import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GROUNDS, LARGE, MARK_GROUNDS, MARKS, TEXT, declarations, pairRatio, readCss, themeVars } from "./contrastPairs";

const UI = path.resolve(__dirname);

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
