import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useCanvasStore } from "@/store/canvasStore";
import { Toolbar } from "./Toolbar";
import userEvent from "@testing-library/user-event";
afterEach(cleanup);
it("offers only the two actual execution behaviors, retaining the legacy local alias as Connected", () => {
 useCanvasStore.setState({ executionMode: "local", isRunning: false });
 render(<Toolbar onRun={vi.fn()} onStop={vi.fn()} />);
 expect(screen.getAllByRole("radio")).toHaveLength(2);
 expect(screen.getByRole("radio", { name: "Connected" }).getAttribute("aria-checked")).toBe("true");
 expect(screen.queryByRole("radio", { name: "Local" })).toBeNull();
});

it("changes execution mode with arrow keys and keeps one tab stop", async () => {
 const user = userEvent.setup();
 useCanvasStore.setState({ executionMode: "mock", isRunning: false });
 render(<Toolbar onRun={vi.fn()} onStop={vi.fn()} />);
 const mock = screen.getByRole("radio", { name: "Mock" });
 const connected = screen.getByRole("radio", { name: "Connected" });
 mock.focus();
 await user.keyboard("{ArrowRight}");
 expect(connected.getAttribute("aria-checked")).toBe("true");
 expect(document.activeElement).toBe(connected);
 expect(mock.tabIndex).toBe(-1);
 expect(connected.tabIndex).toBe(0);
 await user.keyboard("{ArrowLeft}");
 expect(mock.getAttribute("aria-checked")).toBe("true");
 expect(document.activeElement).toBe(mock);
});
