import { beforeEach, describe, expect, it } from "vitest";
import { useThreadStore } from "@/store/threadStore";
import { groupSessions, listSessions } from "./sessions";

describe("listSessions", () => {
  beforeEach(() => {
    useThreadStore.setState({
      threads: [
        { id: "b", title: "Later", createdAt: 1, updatedAt: 2, archived: false },
        { id: "a", title: "Pinned one", createdAt: 1, updatedAt: 1, archived: false, pinned: true, unread: true } as never,
        { id: "c", title: "Old", createdAt: 1, updatedAt: 9, archived: true },
      ],
      activeThreadId: "b",
      messagesByThread: {},
    });
  });

  it("adapts threads and keeps pinned sessions first", () => {
    const groups = groupSessions(listSessions());
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((session) => session.id)).toEqual(["a", "b"]);
    expect(groups[0].sessions[0].unread).toBe(true);
    expect(listSessions().find((session) => session.id === "c")?.archived).toBe(true);
  });
});
