/**
 * The production export omits /dev unless NEXT_PUBLIC_OH_DEV_ROUTES=1.
 * Next still emits an error document for a gated route; remove it so a static
 * host answers 404.
 */
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.NEXT_PUBLIC_OH_DEV_ROUTES === "1") {
  console.log("Dev routes kept (NEXT_PUBLIC_OH_DEV_ROUTES=1).");
} else {
  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out", "dev");
  rmSync(out, { recursive: true, force: true });
  console.log("Dev routes removed from the production export.");
}
