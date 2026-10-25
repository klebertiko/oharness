import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const script = (name: string, ...args: string[]) =>
  execFileSync(process.execPath, [path.join(repoRoot, "scripts", name), ...args], { cwd: repoRoot, encoding: "utf8" });

describe("design tokens", () => {
  it("match frontend/src/app/globals.css exactly", () => {
    expect(script("design-tokens.mjs", "--check")).toContain("Tokens match globals.css");
  });

  it("also guards the type roles against .t-* and the @theme text scale", () => {
    expect(script("design-tokens.mjs", "--check")).toContain("type roles match");
  });

  it("emits the font families under the names the previews use", () => {
    const css = script("design-tokens.mjs", "--css");
    expect(css).toContain("--font-ui:");
    expect(css).toContain("--font-mono:");
  });

  it("emit CSS for every token", () => {
    const css = script("design-tokens.mjs", "--css");
    expect(css).toContain(":root {");
    expect(css).toContain('[data-theme="light"] {');
    expect(css).toContain("--signal:");
  });

  it("pass the required contrast pairs in both themes", () => {
    expect(() => script("check-contrast.mjs")).not.toThrow();
  });

  it("keep the README contrast table current", () => {
    const readme = fs.readFileSync(path.join(repoRoot, "docs/design-system/README.md"), "utf8").replace(/\r\n/g, "\n");
    const match = /<!-- contrast:start -->\n([\s\S]*?)\n<!-- contrast:end -->/.exec(readme);
    expect(match, "README is missing the contrast markers").not.toBeNull();
    expect(match![1].trim()).toBe(script("check-contrast.mjs", "--md").trim());
  });
});
