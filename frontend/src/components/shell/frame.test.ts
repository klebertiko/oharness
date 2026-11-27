import { describe, expect, it } from "vitest";
import {
  CENTER_MIN,
  DOCK_MIN,
  SIDEBAR_OPEN,
  SIDEBAR_RAIL,
  cycleSidebar,
  dockBox,
  dockDrag,
  flowWidth,
  showsPeek,
  sidebarDrag,
} from "./frame";

describe("sidebar cycle", () => {
  it("cycles open, icon strip, then hidden on a wide window", () => {
    expect(cycleSidebar("open", 1280)).toBe("rail");
    expect(cycleSidebar("rail", 1280)).toBe("hidden");
    expect(cycleSidebar("hidden", 1280)).toBe("open");
  });

  it("toggles the strip and hidden between 768 and 1024", () => {
    expect(cycleSidebar("open", 1024)).toBe("hidden");
    expect(cycleSidebar("hidden", 900)).toBe("rail");
    expect(showsPeek("rail", 900)).toBe(true);
    expect(showsPeek("hidden", 900)).toBe(false);
  });

  it("gives the freed width to the center", () => {
    expect(flowWidth("open", 1440, 280)).toBe(280);
    expect(flowWidth("rail", 1440, 280)).toBe(SIDEBAR_RAIL);
    expect(flowWidth("hidden", 1440, 280)).toBe(0);
    expect(flowWidth("open", 900, 280)).toBe(SIDEBAR_RAIL);
    expect(flowWidth("open", 700, 280)).toBe(0);
  });

  it("collapses when dragged below half the minimum and restores on reset width", () => {
    expect(sidebarDrag(100).mode).toBe("rail");
    expect(sidebarDrag(200).mode).toBe("open");
    expect(sidebarDrag(200).width).toBe(220);
    expect(sidebarDrag(500).width).toBe(400);
  });
});

describe("dock box", () => {
  it("uses the remembered width and yields before the center goes under its minimum", () => {
    const column = dockBox(1440, 280, true, null);
    expect(column.kind).toBe("column");
    expect(1440 - 280 - column.width).toBeGreaterThanOrEqual(CENTER_MIN);
    const tight = dockBox(700, 0, true, null);
    expect(tight.kind).toBe("overlay");
  });

  it("hides when closed and collapses when dragged under the snap point", () => {
    expect(dockBox(1440, 280, false, 400).kind).toBe("hidden");
    expect(dockDrag(DOCK_MIN / 2 - 1).open).toBe(false);
    expect(dockDrag(300).open).toBe(true);
  });

  it("defaults the open width to 280", () => {
    expect(SIDEBAR_OPEN).toBe(280);
    expect(SIDEBAR_RAIL).toBe(56);
  });
});
