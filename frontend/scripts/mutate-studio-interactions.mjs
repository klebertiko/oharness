import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = mkdtempSync(join(tmpdir(), "oharness-interactions-mutation-"));
cpSync(join(frontend, "src"), join(sandbox, "src"), { recursive: true });
for (const file of ["package.json", "tsconfig.json", "vitest.config.ts"]) cpSync(join(frontend, file), join(sandbox, file));
symlinkSync(join(frontend, "node_modules"), join(sandbox, "node_modules"), process.platform === "win32" ? "junction" : "dir");
const tests = ["src/components/agent/ChatComposer.test.tsx", "src/components/studio/ValidateDock.test.tsx", "src/store/canvasStore.authoring.test.ts", "src/components/canvas/nodeProvider.test.ts"];
const targets = ["src/components/agent/ChatComposer.tsx", "src/components/studio/ValidateDock.tsx", "src/store/canvasStore.ts", "src/components/canvas/nodeProvider.ts"];
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const originalHashes = Object.fromEntries(targets.map(file => [file, hash(join(frontend, file))]));
const runner = join(frontend, "node_modules/vitest/vitest.mjs");
const run = () => spawnSync(process.execPath, [runner, "run", ...tests, "--reporter=json"], { cwd: sandbox, encoding: "utf8", timeout: 60000 });
const baseline = run();
if (baseline.status !== 0) throw new Error("Mutation baseline failed: " + baseline.stdout + baseline.stderr);
const cases = [
  [
    "slash-menu-suppressed",
    "src/components/agent/ChatComposer.tsx",
    "const open = query !== null && dismissed !== value;",
    "const open = false;"
  ],
  [
    "slash-selection-submits",
    "src/components/agent/ChatComposer.tsx",
    "    command.run?.();",
    "    command.run?.(); onSend();"
  ],
  [
    "slash-live-guard-removed",
    "src/components/agent/ChatComposer.tsx",
    "    if (live) return;",
    ""
  ],
  [
    "slash-escape-erases-draft",
    "src/components/agent/ChatComposer.tsx",
    "event.stopPropagation(); setDismissed(value);",
    "event.stopPropagation(); onChange(\"\"); setDismissed(value);"
  ],
  [
    "unknown-command-submits",
    "src/components/agent/ChatComposer.tsx",
    "if (options[selected]) choose(options[selected]);",
    "if (options[selected]) choose(options[selected]); else onSend();"
  ],
  [
    "stale-validation-visible",
    "src/components/studio/ValidateDock.tsx",
    "const fresh = resultFor === key;",
    "const fresh = true;"
  ],
  [
    "async-validation-not-discarded",
    "src/components/studio/ValidateDock.tsx",
    "const result = await validateBundle(bundle); if (!current()) return;",
    "const result = await validateBundle(bundle);"
  ],
  [
    "cross-bundle-undo-restored",
    "src/store/canvasStore.ts",
    "    set({ _history: [], _historyIndex: -1, awaitingHuman: null });",
    ""
  ],
  [
    "run-allows-load",
    "src/store/canvasStore.ts",
    "loadGraph: (nodes, edges) => {\n    if (get().isRunning) return;",
    "loadGraph: (nodes, edges) => {"
  ],
  [
    "node-pin-hidden-by-legacy",
    "src/components/canvas/nodeProvider.ts",
    "  const pin = data.providerIds?.[0];",
    "  const pin = undefined;"
  ]
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
const output = join(frontend, "../.harness/sprint-2026-09-13/story-STUDIO-CLARITY/evidence/mutation-interactions.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ finishedAt: new Date().toISOString(), scope: "10 targeted semantic mutants; not an exhaustive mutation score", sandbox, baseline: "passed", originalTargetsUnchanged, results }, null, 2));
if (!originalTargetsUnchanged || results.some(result => result.status !== "killed")) process.exitCode = 1;
