import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { axeViolations } from "@/test/axe";
import { DraftCard } from "./DraftCard";

afterEach(() => {
  cleanup();
  document.documentElement.dataset.theme = "dark";
});

it("editing after an approval asks the parent to clear it", async () => {
  const onEdit = vi.fn();
  const onSend = vi.fn();
  render(<DraftCard body="ola" approved onEdit={onEdit} onSend={onSend} onDiscard={() => undefined} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.clear(screen.getByRole("textbox", { name: "Edit" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Edit" }), "nova");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(onEdit).toHaveBeenCalledWith("nova");
  expect(onSend).not.toHaveBeenCalled();
});

it("has no serious axe violations in either theme", async () => {
  for (const theme of ["dark", "light"] as const) {
    document.documentElement.dataset.theme = theme;
    const view = render(<DraftCard body="a draft" approved={false} onEdit={() => undefined} onSend={() => undefined} onDiscard={() => undefined} />);
    expect(await axeViolations(view.container)).toEqual([]);
    cleanup();
  }
});
