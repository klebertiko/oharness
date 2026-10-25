"use client";

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { downloadOHarness, serializeBundle, type OHarnessBundle } from "./bundlesApi";
import { nativeDialogAvailable } from "./nativeDialog";

export type SaveOhmResult =
  | { status: "saved"; native: true; path: string; name: string }
  | { status: "saved"; native: false; name: string }
  | { status: "cancelled" };

/** Default file name for a bundle: manifest name, filesystem-unsafe characters replaced. */
export function ohmFileName(bundle: OHarnessBundle): string {
  const base = (bundle.manifest.name || "harness").trim().replace(/\s+/g, "_").replace(/[\x5c/:*?"<>|]/g, "_");
  return `${base || "harness"}.ohm`;
}

function baseName(path: string): string {
  return path.split(/[\x5c/]/).pop() || path;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Save a harness bundle as `.ohm`. In the desktop shell this opens the native
 * Save dialog and writes the file where the person chose (the dialog adds the
 * picked path to the fs scope, so no broad filesystem grant is needed). In the
 * plain browser dev preview it falls back to a blob download. Cancelling the
 * dialog is not an error; every failure throws a descriptive Error.
 */
export async function saveOhmFile(bundle: OHarnessBundle, suggestedName?: string): Promise<SaveOhmResult> {
  const name = suggestedName ?? ohmFileName(bundle);
  if (!nativeDialogAvailable()) {
    downloadOHarness(bundle, name);
    return { status: "saved", native: false, name };
  }

  let chosen: string | null;
  try {
    chosen = await save({
      defaultPath: name,
      filters: [{ name: "OHarness", extensions: ["ohm"] }],
    });
  } catch (error) {
    throw new Error(`Could not open the Save dialog: ${reason(error)}`);
  }
  if (!chosen) return { status: "cancelled" };

  // Write exactly where the person chose: the dialog adds only that path to
  // the fs scope, so a renamed path (e.g. with ".ohm" appended) would be
  // refused. The `.ohm` filter lets the OS dialog add the extension itself.
  const path = chosen;
  try {
    await writeTextFile(path, serializeBundle(bundle));
  } catch (error) {
    throw new Error(`Could not save ${baseName(path)}: ${reason(error)}`);
  }
  return { status: "saved", native: true, path, name: baseName(path) };
}
