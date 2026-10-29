import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { Toolbar } from "./Toolbar";

afterEach(cleanup);

/* #199: the keycap in the primary Run button must stay on the plain `signal` fill. Tinting it with `signal-ink`
   lightened it in Ivory (signal-ink is near-white there) and put near-white text on it at 3.73:1. The pair
   `signal-ink` on `signal` is checked at 4.5:1 in both themes by scripts/check-contrast.mjs; this only pins the classes. The real guard is the axe run in
   e2e-studio-proposal.mjs, which no longer excludes the Run toolbar. */
it("the Run keycap has no background tint, so its text sits on the signal fill", () => {
  useCanvasStore.setState({ isRunning: false, nodes: [{ id: "n" }] as never });
  render(<Toolbar onRun={vi.fn()} onStop={vi.fn()} />);
  const chord = screen.getByRole("button", { name: /^Run/ }).querySelector("kbd")?.parentElement;
  expect(chord?.className).toContain("[&_kbd]:bg-transparent");
  expect(chord?.className).toContain("[&_kbd]:text-signal-ink");
  expect(chord?.className).not.toMatch(/\[&_kbd\]:bg-\[color-mix/);
});
