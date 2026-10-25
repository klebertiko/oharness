import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = mkdtempSync(join(tmpdir(), "oharness-studio-mutation-"));
cpSync(join(frontend, "src"), join(sandbox, "src"), { recursive: true });
for (const file of ["package.json", "tsconfig.json", "vitest.config.ts"]) cpSync(join(frontend, file), join(sandbox, file));
symlinkSync(join(frontend, "node_modules"), join(sandbox, "node_modules"), process.platform === "win32" ? "junction" : "dir");
const tests = ["src/lib/studio.test.ts", "src/components/shell/studioNavigation.test.ts", "src/components/harnesses/HarnessLibrary.studio.test.tsx"];
const targets = ["src/lib/studio.ts", "src/components/shell/shellStore.ts", "src/components/harnesses/HarnessLibrary.tsx"];
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const originalHashes = Object.fromEntries(targets.map(file => [file, hash(join(frontend, file))]));
const runner = join(frontend, "node_modules/vitest/vitest.mjs");
const run = () => spawnSync(process.execPath, [runner, "run", ...tests, "--reporter=json"], { cwd: sandbox, encoding: "utf8", timeout: 60000 });
const baseline = run();
if (baseline.status !== 0) throw new Error("Mutation baseline failed: " + baseline.stdout + baseline.stderr);
const cases = [
  ["default-loader-bypassed", targets[0], "const bundle = await fetchDefault();", 'const bundle = { manifest: { id: "local-sketch" }, graph: { nodes: [], edges: [] } };'],
  ["bundled-content-lost", targets[0], "replaceBundle(copy);", "replaceBundle({ ...copy, content: {} });"],
  ["sample-inherits-content", targets[0], "composeBundleFromCanvas(null, {", "composeBundleFromCanvas(useHarnessSessionStore.getState().activeBundle as any, {"],
  ["abandoned-load-opens", targets[0], "if (!signal?.aborted)", "if (true)"],
  ["draft-forgotten", targets[1], 'studioHasDraft: get().studioHasDraft || studioView === "editor",', "studioHasDraft: false,"],
  ["chat-pins-lost", targets[0], "composeBundleFromCanvas(base, { nodes, edges, harnessMeta })", "composeBundleFromCanvas(base, { nodes: nodes.map(n => ({ ...n, data: { ...n.data, providerIds: [] } })), edges, harnessMeta })"],
  ["chat-content-lost", targets[0], "session.replaceBundle(bundle as unknown as HarnessBundle);", "session.replaceBundle({ ...bundle, content: {} } as unknown as HarnessBundle);"],
  ["chat-not-enabled", targets[0], "session.setEnabled(true);", "session.setEnabled(false);"],
  ["default-import-substituted", targets[2], "onPicked?.(parsed as unknown as HarnessBundle);", "onPicked?.(useHarnessSessionStore.getState().activeBundle!);"],
  ["editing-enables-chat", targets[2], "if (onPicked) onPicked(entry.bundle);", "if (onPicked) { activate(entry.id); onPicked(entry.bundle); }"],
];
const results = [];
for (const [id, file, before, after] of cases) {
  const target = join(sandbox, file), original = readFileSync(target, "utf8");
  if (!original.includes(before)) throw new Error("Missing mutation target: " + id);
  writeFileSync(target, original.replace(before, after));
  let outcome;
  try { outcome = run(); } finally { writeFileSync(target, original); }
  let report;
  try { report = JSON.parse(outcome.stdout); } catch {}
  const failedAssertions = report?.numFailedTests ?? 0;
  const status = outcome.error ? "timeout-or-error" : outcome.status === 0 ? "survived" : failedAssertions > 0 ? "killed" : "invalid";
  results.push({ id, file, status, failedAssertions });
  console.log(id + ": " + status);
}
const originalTargetsUnchanged = targets.every(file => originalHashes[file] === hash(join(frontend, file)));
const output = join(frontend, "../.harness/sprint-2026-09-13/story-STUDIO-CLARITY/evidence/mutation-studio.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ finishedAt: new Date().toISOString(), scope: "10 targeted semantic mutants; not an exhaustive mutation score", sandbox, baseline: "passed", originalTargetsUnchanged, results }, null, 2));
if (!originalTargetsUnchanged || results.some(result => result.status !== "killed")) process.exitCode = 1;
