import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OHarnessBundle } from "./bundlesApi";

const saveMock = vi.fn();
const writeTextFileMock = vi.fn();
const downloadMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveMock(...args),
  open: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (...args: unknown[]) => writeTextFileMock(...args),
}));
vi.mock("./bundlesApi", async importOriginal => ({
  ...(await importOriginal<typeof import("./bundlesApi")>()),
  downloadOHarness: (...args: unknown[]) => downloadMock(...args),
}));

import { ohmFileName, saveOhmFile } from "./ohmFile";

const bundle = {
  schemaVersion: "1.0.0",
  manifest: { id: "h1", name: "My Harness", description: "d" },
  graph: { nodes: [], edges: [] },
} as unknown as OHarnessBundle;

function setTauri(on: boolean) {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = on
    ? { invoke: () => Promise.resolve() }
    : undefined;
}

describe("ohmFileName", () => {
  it("derives a safe .ohm name from the manifest", () => {
    expect(ohmFileName(bundle)).toBe("My_Harness.ohm");
    expect(ohmFileName({ ...bundle, manifest: { ...bundle.manifest, name: "" } } as OHarnessBundle)).toBe("harness.ohm");
    expect(ohmFileName({ ...bundle, manifest: { ...bundle.manifest, name: 'a/b\\c:d*e?"f<g>h|i' } } as OHarnessBundle)).toBe("a_b_c_d_e__f_g_h_i.ohm");
  });
});

describe("saveOhmFile", () => {
  beforeEach(() => {
    saveMock.mockReset();
    writeTextFileMock.mockReset();
    downloadMock.mockReset();
    setTauri(false);
  });
  afterEach(() => setTauri(false));

  describe("desktop shell", () => {
    beforeEach(() => setTauri(true));

    it("opens the native Save dialog with an .ohm filter and writes the bundle JSON to the chosen path", async () => {
      saveMock.mockResolvedValue("C:\\Users\\me\\Docs\\chosen.ohm");
      writeTextFileMock.mockResolvedValue(undefined);
      const result = await saveOhmFile(bundle, "My_Harness.ohm");
      expect(saveMock).toHaveBeenCalledWith({
        defaultPath: "My_Harness.ohm",
        filters: [{ name: "OHarness", extensions: ["ohm"] }],
      });
      expect(writeTextFileMock).toHaveBeenCalledWith("C:\\Users\\me\\Docs\\chosen.ohm", JSON.stringify(bundle, null, 2));
      expect(downloadMock).not.toHaveBeenCalled();
      expect(result).toEqual({ status: "saved", native: true, path: "C:\\Users\\me\\Docs\\chosen.ohm", name: "chosen.ohm" });
    });

    it("derives the suggested name from the manifest when none is given", async () => {
      saveMock.mockResolvedValue("/home/me/x.ohm");
      await saveOhmFile(bundle);
      expect(saveMock.mock.calls[0][0].defaultPath).toBe("My_Harness.ohm");
    });

    it("reports cancelled and writes nothing when the dialog is dismissed", async () => {
      saveMock.mockResolvedValue(null);
      expect(await saveOhmFile(bundle)).toEqual({ status: "cancelled" });
      expect(writeTextFileMock).not.toHaveBeenCalled();
    });

    it("writes exactly the path the dialog returned, never a renamed one", async () => {
      // Only the picked path is added to the fs scope; renaming it after the
      // dialog (e.g. appending .ohm) would be refused with PathForbidden. The
      // .ohm filter makes the OS dialog add the extension itself (Windows).
      saveMock.mockResolvedValue("C:\\out\\harness");
      const result = await saveOhmFile(bundle);
      expect(writeTextFileMock.mock.calls[0][0]).toBe("C:\\out\\harness");
      expect(result).toMatchObject({ status: "saved", path: "C:\\out\\harness", name: "harness" });
    });

    it("keeps an existing .ohm extension regardless of case", async () => {
      saveMock.mockResolvedValue("/tmp/Thing.OHM");
      await saveOhmFile(bundle);
      expect(writeTextFileMock.mock.calls[0][0]).toBe("/tmp/Thing.OHM");
    });

    it("surfaces a write failure as a clear Error naming the file", async () => {
      saveMock.mockResolvedValue("/ro/x.ohm");
      writeTextFileMock.mockRejectedValue("forbidden path: /ro/x.ohm");
      await expect(saveOhmFile(bundle)).rejects.toThrow(/Could not save x\.ohm.*forbidden path/);
    });

    it("surfaces a dialog failure as a clear Error", async () => {
      saveMock.mockRejectedValue(new Error("dialog crashed"));
      await expect(saveOhmFile(bundle)).rejects.toThrow(/Could not open the Save dialog.*dialog crashed/);
      expect(writeTextFileMock).not.toHaveBeenCalled();
    });
  });

  describe("browser dev preview", () => {
    it("falls back to a blob download and never touches the Tauri plugins", async () => {
      const result = await saveOhmFile(bundle, "custom.ohm");
      expect(downloadMock).toHaveBeenCalledWith(bundle, "custom.ohm");
      expect(saveMock).not.toHaveBeenCalled();
      expect(writeTextFileMock).not.toHaveBeenCalled();
      expect(result).toEqual({ status: "saved", native: false, name: "custom.ohm" });
    });
  });
});
