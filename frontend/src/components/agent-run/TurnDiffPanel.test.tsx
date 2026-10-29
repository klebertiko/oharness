import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyRun, runReducer } from "./runReducer";
import { TurnDiffPanel } from "./TurnDiffPanel";
import { turnDiffApi } from "@/lib/turnDiffApi";
import { axeViolations } from "@/test/axe";

const files = [
  { path: "src/a.txt", status: "modified", added: 2, removed: 1, binary: false, revertible: true, diff: "--- before\n+++ after\n-two\n+TWO\n", diff_truncated: false },
  { path: "img.bin", status: "modified", added: 0, removed: 0, binary: true, revertible: false, diff: "", diff_truncated: false },
  { path: "new.txt", status: "added", added: 1, removed: 0, binary: false, revertible: true, diff: "+x\n", diff_truncated: false },
];

describe("turn diff in the run state", () => {
  it("keeps the files of turn_diff for the transcript and for history replay", () => {
    const s = runReducer(emptyRun, { type: "sse", event: "turn_diff", data: { files, omitted: 0, complete: true } });
    expect(s.turnDiff?.files.map((f) => f.path)).toEqual(["src/a.txt", "img.bin", "new.txt"]);
    expect(s.turnDiff?.files[0]).toMatchObject({ added: 2, removed: 1, revertible: true });
  });
});

describe("TurnDiffPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  const diff = { files: files.map((f) => ({ ...f, binary: f.binary })), omitted: 0, complete: true } as never;

  it("lists the files with counts and reverts exactly one", async () => {
    const user = userEvent.setup();
    const revert = vi.spyOn(turnDiffApi, "revert").mockResolvedValue({ ok: true });
    render(<TurnDiffPanel runId="r1" turnDiff={diff} />);
    expect(screen.getByText("src/a.txt")).toBeTruthy();
    expect(screen.getByText("+2 −1")).toBeTruthy();
    expect(screen.getByText("binary — no diff, cannot be reverted")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert src/a.txt" }));
    await waitFor(() => expect(revert).toHaveBeenCalledWith("r1", "src/a.txt"));
    expect(revert).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("reverted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revert src/a.txt" })).toBeNull();
    expect(screen.getByRole("button", { name: "Revert new.txt" })).toBeTruthy();
  });

  it("shows files already reverted as reverted when a run is reopened", async () => {
    vi.spyOn(turnDiffApi, "state").mockResolvedValue({ "src/a.txt": true, "new.txt": false });
    render(<TurnDiffPanel runId="r1" turnDiff={diff} />);
    expect(await screen.findByText("reverted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revert src/a.txt" })).toBeNull();
    expect(screen.getByRole("button", { name: "Revert new.txt" })).toBeTruthy();
  });

  it("explains a revert that cannot happen because the folder is gone", async () => {
    const user = userEvent.setup();
    vi.spyOn(turnDiffApi, "revert").mockResolvedValue({ ok: false, code: "workspace_gone" });
    render(<TurnDiffPanel runId="r1" turnDiff={diff} />);
    await user.click(screen.getByRole("button", { name: "Revert new.txt" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no longer there/);
  });

  it("shows why a revert was refused", async () => {
    const user = userEvent.setup();
    vi.spyOn(turnDiffApi, "revert").mockResolvedValue({ ok: false, code: "changed_since" });
    render(<TurnDiffPanel runId="r1" turnDiff={diff} />);
    await user.click(screen.getByRole("button", { name: "Revert new.txt" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/changed after the turn/);
  });

  it("opens a diff with the keyboard and has no axe violations", async () => {
    const user = userEvent.setup();
    const { container } = render(<TurnDiffPanel runId="r1" turnDiff={diff} />);
    const toggle = screen.getByRole("button", { name: "Show diff for src/a.txt" });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/\+TWO/)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("states when the snapshot was incomplete", () => {
    render(<TurnDiffPanel runId="r1" turnDiff={{ files: [], omitted: 3, complete: false } as never} />);
    expect(screen.getByText(/too large to track completely/)).toBeTruthy();
    expect(screen.getByText(/3 more files/)).toBeTruthy();
  });
});
