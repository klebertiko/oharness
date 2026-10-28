import { existsSync, mkdirSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pythonCandidates = platform() === "win32"
  ? [join(root, "backend", ".venv", "Scripts", "python.exe"), "python"]
  : [join(root, "backend", ".venv", "bin", "python"), "python3", "python"];
const python = pythonCandidates.find((candidate) => candidate === "python" || candidate === "python3" || existsSync(candidate));
if (!python) throw new Error("Python was not found; create backend/.venv first.");

const triples = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
};
const triple = triples[`${platform()}-${arch()}`];
if (!triple) throw new Error(`Unsupported desktop target: ${platform()}-${arch()}`);

function run(args) {
  const result = spawnSync(python, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const pipCheck = spawnSync(python, ["-m", "pip", "--version"], { cwd: root, stdio: "ignore" });
if (pipCheck.status !== 0) run(["-m", "ensurepip", "--upgrade"]);
// PyInstaller bundles what the interpreter can import, so the runtime
// requirements must be installed too (a clean CI runner has none of them).
run([
  "-m", "pip", "install", "-q",
  "-r", join(root, "backend", "requirements.txt"),
  "-r", join(root, "backend", "requirements-build.txt"),
]);
mkdirSync(join(root, "backend", "build", "pyinstaller"), { recursive: true });
mkdirSync(join(root, "src-tauri", "binaries"), { recursive: true });

const separator = platform() === "win32" ? ";" : ":";
run([
  "-m", "PyInstaller",
  "--noconfirm", "--clean", "--onefile",
  "--name", `oharness-sidecar-${triple}`,
  "--paths", join(root, "backend"),
  "--hidden-import", "aiosqlite",
  "--distpath", join(root, "src-tauri", "binaries"),
  "--workpath", join(root, "backend", "build", "pyinstaller"),
  "--specpath", join(root, "backend", "build"),
  "--add-data", `${join(root, "backend", "oharness", "fixtures", "default-agile.ohm")}${separator}oharness/fixtures`,
  "--add-data", `${join(root, "backend", "oharness", "fixtures", "deepseek-harness.ohm")}${separator}oharness/fixtures`,
  "--add-data", `${join(root, "backend", "oharness", "fixtures", "mattpocock-skills.ohm")}${separator}oharness/fixtures`,
  "--add-data", `${join(root, "backend", "oharness", "schema", "oharness.schema.json")}${separator}oharness/schema`,
  "--add-data", `${join(root, "backend", "studio_copilot", "catalog.json")}${separator}studio_copilot`,
  "--add-data", `${join(root, "backend", "sandbox", "permission_modes.json")}${separator}sandbox`,
  join(root, "backend", "sidecar_entry.py"),
]);
