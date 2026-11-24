/**
 * The production export omits /dev unless NEXT_PUBLIC_OH_DEV_ROUTES=1.
 * Next still emits an error document for a gated route; remove it so a static
 * host answers 404. The build fails if anything under /dev survives: the
 * packaged app (Tauri serves out/ as its assets) must not carry those pages at
 * all, whatever its host does with an unknown path.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.NEXT_PUBLIC_OH_DEV_ROUTES === "1") {
  console.log("Dev routes kept (NEXT_PUBLIC_OH_DEV_ROUTES=1).");
} else {
  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out", "dev");
  rmSync(out, { recursive: true, force: true });
  const root = join(out, "..");
  const left = existsSync(out) || readdirSync(root).some((name) => /^dev(\.html|\.txt)?$/.test(name));
  if (left) {
    console.error("Dev routes are still in out/ after the strip: refusing to ship them.");
    process.exit(1);
  }
  console.log("Dev routes removed from the production export.");
}
