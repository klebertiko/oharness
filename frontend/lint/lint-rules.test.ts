// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function lint(source: string): string {
  const dir = mkdtempSync(path.join(__dirname, ".probe-"));
  try {
    const file = path.join(dir, "probe.tsx");
    writeFileSync(file, source);
    const r = spawnSync("npx", ["biome", "lint", file], { encoding: "utf8" });
    return r.stdout + r.stderr;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases: [string, string, string][] = [
  ["unescaped quote in JSX text", `export const A = () => <p>don't</p>;\n`, "Escape quotes"],
  ["anonymous default function", `export default function () { return 1; }\n`, "Give the default export a name"],
  ["anonymous default arrow", `export default () => 1;\n`, "Give the default export a name"],
  ["anonymous default class", `export default class { x = 1; }\n`, "Give the default export a name"],
  ["unused expression", `export const f = () => { 1 + 2; };\n`, "noUnusedExpressions"],
  ["require()", `export const x = require("node:fs");\n`, "noCommonJs"],
  ["namespace", `export namespace N { export const a = 1; }\n`, "noNamespace"],
  ["@ts-ignore", `// @ts-ignore\nexport const z: number = "s";\n`, "noTsIgnore"],
  ["sync script", `export const S = () => <script src="/a.js" />;\n`, "noSyncScripts"],
];

describe("lint coverage (docs/lint-coverage.md)", () => {
  it.each(cases)("flags %s", (_n, src, needle) => {
    expect(lint(src)).toContain(needle);
  });

  it("accepts named default exports and escaped text", () => {
    const out = lint(`export default function Page() { return <p>don&apos;t</p>; }\n`);
    expect(out).not.toContain("plugin");
  });
});
