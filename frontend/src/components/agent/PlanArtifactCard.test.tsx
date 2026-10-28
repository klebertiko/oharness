import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlanArtifactCard } from "./PlanArtifactCard";

afterEach(cleanup);

it("shows the plan in a named region with Approve and Discard, nothing else runnable", () => {
  render(<PlanArtifactCard text={"1. Add the page\n2. Run the tests"} onApprove={vi.fn()} onDiscard={vi.fn()} />);
  const region = screen.getByRole("region", { name: "Plan awaiting your approval" });
  expect(region.textContent).toContain("1. Add the page");
  expect(region.textContent).toMatch(/Nothing has run/);
  expect(screen.getByRole("button", { name: "Approve plan" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Discard plan" })).toBeTruthy();
});

it("Approve and Discard call their handlers", () => {
  const onApprove = vi.fn(); const onDiscard = vi.fn();
  render(<PlanArtifactCard text="p" onApprove={onApprove} onDiscard={onDiscard} />);
  fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard plan" }));
  expect(onApprove).toHaveBeenCalledTimes(1);
  expect(onDiscard).toHaveBeenCalledTimes(1);
});

it("while busy both buttons are disabled; an error is announced", () => {
  render(<PlanArtifactCard text="p" busy error="Couldn't approve the plan." onApprove={vi.fn()} onDiscard={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Approve plan" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Discard plan" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("Couldn't approve the plan.");
});
