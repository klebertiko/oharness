import { beforeEach, describe, expect, it } from "vitest";
import { HARNESS_RECENT_KEY, useHarnessRecentStore } from "./harnessRecentStore";

beforeEach(() => {
  localStorage.clear();
  useHarnessRecentStore.setState({ ids: [] });
});

describe("harnessRecentStore", () => {
  it("remembers the last harnesses chosen, newest first, without repeats", () => {
    const { push } = useHarnessRecentStore.getState();
    for (const id of ["a", "b", "c", "a"]) push(id);
    expect(useHarnessRecentStore.getState().ids).toEqual(["a", "c", "b"]);
  });

  it("keeps at most five and persists them", () => {
    for (const id of "abcdefg") useHarnessRecentStore.getState().push(id);
    expect(useHarnessRecentStore.getState().ids).toEqual(["g", "f", "e", "d", "c"]);
    expect(JSON.parse(localStorage.getItem(HARNESS_RECENT_KEY)!)).toEqual(["g", "f", "e", "d", "c"]);
  });

  it("survives a broken stored value", () => {
    localStorage.setItem(HARNESS_RECENT_KEY, "{nope");
    useHarnessRecentStore.getState().load();
    expect(useHarnessRecentStore.getState().ids).toEqual([]);
  });
});
