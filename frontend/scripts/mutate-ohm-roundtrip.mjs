import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Mutate a disposable source copy: the developer's running Studio stays intact.
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = mkdtempSync(join(tmpdir(), "oharness-ohm-mutation-"));
cpSync(join(frontend, "src"), join(sandbox, "src"), { recursive: true });
for (const file of ["package.json", "tsconfig.json", "vitest.config.ts"]) {
  cpSync(join(frontend, file), join(sandbox, file));
}
symlinkSync(join(frontend, "node_modules"), join(sandbox, "node_modules"), process.platform === "win32" ? "junction" : "dir");
const tests = ["src/lib/bundlesApi.test.ts", "src/lib/bundleGraph.authoring.test.ts", "src/components/studio/ValidateDock.test.tsx"];
const runner = join(frontend, "node_modules/vitest/vitest.mjs");
const run = () => spawnSync(process.execPath, [runner, "run", ...tests, "--reporter=json"], {
  cwd: sandbox, encoding: "utf8", timeout: 60000,
});
const baseline = run();
if (baseline.status !== 0) {
  process.stderr.write(baseline.stdout + baseline.stderr);
  throw new Error("Mutation baseline must pass before any mutant is evaluated.");
}

const mutations = [
  ["node-position", "bundlesApi", "canvasNodeToBundleNode", "delete result.position;"],
  ["node-data", "bundlesApi", "canvasNodeToBundleNode", "result.data = {};"],
  ["node-provider-pin", "bundlesApi", "canvasNodeToBundleNode", "if (result.data) delete result.data.providerIds;"],
  ["raw-api-key-export", "bundlesApi", "canvasNodeToBundleNode", "if (args[0].data?.apiKey) result.data.apiKey = args[0].data.apiKey;"],
  ["edge-condition", "bundlesApi", "canvasEdgeToBundleEdge", "if (result.data) delete result.data.condition;"],
  ["edge-signal", "bundlesApi", "canvasEdgeToBundleEdge", "if (result.data) delete result.data.signal;"],
  ["edge-handles", "bundlesApi", "canvasEdgeToBundleEdge", "delete result.sourceHandle; delete result.targetHandle;"],
  ["bundle-content", "bundlesApi", "composeBundleFromCanvas", "result.content = {};"],
  ["import-position", "bundleGraph", "bundleGraphToCanvas", "result.nodes.forEach(n => { n.position = {x:0,y:0}; });"],
  ["import-data", "bundleGraph", "bundleGraphToCanvas", "result.nodes.forEach(n => { n.data = {label:n.id}; });"],
  ["import-edges", "bundleGraph", "bundleGraphToCanvas", "result.edges = [];"],
  ["import-legacy-role", "bundleGraph", "bundleGraphToCanvas", "result.nodes.forEach(n => { delete n.data.roleId; });"],
];
const results = [];
for (const [id, module, name, change] of mutations) {
  const path = join(sandbox, `src/lib/${module}.ts`);
  const original = readFileSync(path, "utf8");
  const declaration = new RegExp(`export function ${name}([<(])`);
  if (!declaration.test(original)) throw new Error(`Mutation target missing: ${name}`);
  const modified = original.replace(declaration, `function original_${name}$1`) +
    `\nexport function ${name}(...args: Parameters<typeof original_${name}>) { const result = original_${name}(...args); ${change} return result; }\n`;
  writeFileSync(path, modified);
  let outcome;
  try { outcome = run(); } finally { writeFileSync(path, original); }
  let report;
  try { report = JSON.parse(outcome.stdout); } catch { /* Transform failures are invalid, never kills. */ }
  const failedAssertions = report?.numFailedTests ?? 0;
  const status = outcome.error ? "timeout-or-error" : outcome.status === 0 ? "survived" : failedAssertions > 0 ? "killed" : "invalid";
  results.push({ id, status, failedAssertions });
  process.stdout.write(`${id}: ${status}\n`);
}
const report = { scope: "12 targeted semantic mutants; not an exhaustive mutation score", sandbox, baseline: "passed", results };
const reportPath = process.env.OHM_MUTATION_REPORT || join(frontend, "../.harness/sprint-2026-09-12/story-OHM-ROUNDTRIP-ASTRA/evidence/mutation.json");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(`Report: ${reportPath}\n`);
if (results.some(r => r.status !== "killed")) process.exitCode = 1;
