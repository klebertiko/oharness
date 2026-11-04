// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// #346: `npm run test:e2e` must not write into versioned sprint folders.
const scripts = path.join(__dirname, "..", "scripts");
const e2e = readdirSync(scripts).filter((name) => /^e2e-.+\.mjs$/.test(name) && name !== "e2e-evidence.mjs");

describe("e2e evidence output", () => {
  it.each(e2e)("%s does not write under .harness/", (name) => {
    const source = readFileSync(path.join(scripts, name), "utf8");
    expect(source.replace(/oh\.harness/g, "")).not.toMatch(/\.harness[\/]/);
  });

  it("the shared helper defaults to the ignored .e2e-out folder", () => {
    const source = readFileSync(path.join(scripts, "e2e-evidence.mjs"), "utf8");
    expect(source).toContain(".e2e-out");
    expect(readFileSync(path.join(__dirname, "..", "..", ".gitignore"), "utf8")).toContain("frontend/.e2e-out/");
  });
});
