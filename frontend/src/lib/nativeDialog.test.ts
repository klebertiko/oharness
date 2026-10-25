import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

import { nativeDialogAvailable, pickFolder } from "./nativeDialog";

function setTauriInternals(invoke: unknown) {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = invoke
    ? { invoke }
    : undefined;
}

describe("nativeDialog", () => {
  beforeEach(() => {
    openMock.mockReset();
    setTauriInternals(undefined);
  });

  afterEach(() => {
    setTauriInternals(undefined);
  });

  it("nativeDialogAvailable is false with no Tauri internals (plain browser preview)", () => {
    expect(nativeDialogAvailable()).toBe(false);
  });

  it("nativeDialogAvailable is true when __TAURI_INTERNALS__.invoke exists", () => {
    setTauriInternals(() => Promise.resolve());
    expect(nativeDialogAvailable()).toBe(true);
  });

  it("pickFolder never calls the native dialog outside Tauri", async () => {
    const result = await pickFolder();
    expect(result).toBeNull();
    expect(openMock).not.toHaveBeenCalled();
  });

  it("pickFolder returns the chosen path inside Tauri", async () => {
    setTauriInternals(() => Promise.resolve());
    openMock.mockResolvedValue("D:\\Development\\src\\OHarness");

    const result = await pickFolder();

    expect(result).toBe("D:\\Development\\src\\OHarness");
    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      canCreateDirectories: true,
    });
  });

  it("pickFolder returns null when the person cancels the OS dialog", async () => {
    setTauriInternals(() => Promise.resolve());
    openMock.mockResolvedValue(null);

    expect(await pickFolder()).toBeNull();
  });

  it("pickFolder degrades to null if the dialog call itself throws", async () => {
    setTauriInternals(() => Promise.resolve());
    openMock.mockRejectedValue(new Error("dialog backend unavailable"));

    expect(await pickFolder()).toBeNull();
  });
});
