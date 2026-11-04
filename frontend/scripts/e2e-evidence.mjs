// Where an e2e script writes its screenshots and result files.
// Never the versioned `.harness/` sprint folders: running the suite must leave the working tree clean.
// OH_E2E_EVIDENCE_DIR picks another root (a sprint story that wants to keep its evidence passes it explicitly).
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function evidenceDir(story) {
  return join(process.env.OH_E2E_EVIDENCE_DIR || join(frontend, ".e2e-out"), story);
}
