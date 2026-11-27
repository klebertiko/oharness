/**
 * Mutation check for the overlay primitives' keyboard contracts. Each mutant removes one behaviour a
 * user relies on (an Escape handler, a value change, a disabled-tab skip, a toast hold); the UI tests
 * must fail for every one of them. Runs in a temp copy of src/, so the working tree is never touched.
 *
 *   node scripts/mutate-ui-primitives.mjs
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The real path: a short (8.3) temp name on Windows would not match the ids vite resolves.
const sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), "oharness-ui-mutation-")));
cpSync(join(frontend, "src"), join(sandbox, "src"), { recursive: true });
for (const file of ["package.json", "tsconfig.json", "vitest.config.ts"]) cpSync(join(frontend, file), join(sandbox, file));
symlinkSync(join(frontend, "node_modules"), join(sandbox, "node_modules"), process.platform === "win32" ? "junction" : "dir");

const ui = "src/components/ui";
const mutants = [
  ["Popover ignores Escape", "Popover.tsx", 'if (event.key !== "Escape") return;', "return;"],
  ["Popover keeps focus in the panel", "Popover.tsx", "      triggerRef.current?.focus();\n    };\n    const onPointer", "    };\n    const onPointer"],
  ["Select never reports a change", "Select.tsx", "onValueChange={onChange}", "onValueChange={() => {}}"],
  ["Menu ignores Escape", "Menu.tsx", '} else if (event.key === "Escape") {', '} else if (event.key === "__none__") {'],
  ["Menu stays open on Tab", "Menu.tsx", '} else if (event.key === "Tab") {', '} else if (event.key === "__none__") {'],
  ["Menu trigger ignores ArrowDown", "Menu.tsx", 'if (event.key !== "ArrowDown" || open) return;', "return;"],
  ["Tabs forget the disabled tab", "Tabs.tsx", "disabled={tab.disabled}", "disabled={false}"],
  ["Tooltip ignores Escape", "Tooltip.tsx", "<TooltipPrimitive.Content", "<TooltipPrimitive.Content onEscapeKeyDown={(event) => event.preventDefault()}"],
  ["Toast leaves while focused", "Toast.tsx", "onFocus={() => hold(item.id)}", "onFocus={() => {}}"],
  ["Dialog drops focus on close", "Dialog.tsx", "              el.focus();", "              void el;"],
  ["ErrorState keeps saying Copied", "ErrorState.tsx", "setTimeout(() => setCopied(false), COPIED_HOLD)", "setTimeout(() => {}, COPIED_HOLD)"],
];

const run = () =>
  spawnSync(process.execPath, [join(frontend, "node_modules/vitest/vitest.mjs"), "run", ui], { cwd: sandbox, encoding: "utf8" });

let survived = 0;
try {
  const baseline = run();
  if (baseline.status !== 0) throw new Error(`baseline fails before any mutation:\n${baseline.stdout}${baseline.stderr}`);
  for (const [name, file, from, to] of mutants) {
    const path = join(sandbox, ui, file);
    const original = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    if (!original.includes(from)) throw new Error(`${name}: the code to mutate is gone from ${file}; update this script`);
    writeFileSync(path, original.replace(from, to));
    const result = run();
    writeFileSync(path, original);
    const killed = result.status !== 0;
    if (!killed) survived += 1;
    console.log(`${killed ? "KILLED  " : "SURVIVED"} ${name}`);
  }
} finally {
  // Drop the node_modules link first: a recursive delete must never walk into the real install.
  unlinkSync(join(sandbox, "node_modules"));
  rmSync(sandbox, { recursive: true, force: true });
}
if (survived) {
  console.error(`${survived} of ${mutants.length} mutants survived`);
  process.exit(1);
}
console.log(`PASS ${mutants.length} of ${mutants.length} mutants killed`);
