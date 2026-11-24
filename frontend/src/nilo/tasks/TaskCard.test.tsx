import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { axeViolations } from "@/test/axe";
import { NotificationSwitch, TaskCard, type TaskCardModel } from "./TaskCard";

afterEach(() => {
  cleanup();
  document.documentElement.dataset.theme = "dark";
});

const running: TaskCardModel = {
  id: "t1",
  title: "Revisar o relatório",
  state: "running",
  elapsed: "00:12",
  milestones: ["Leu o arquivo"],
};

it("shows a working card with cancel, not a narrated handoff", async () => {
  const onCancel = vi.fn();
  render(<TaskCard task={running} onCancel={onCancel} onContinue={() => undefined} />);
  expect(screen.getByRole("img", { name: "Working" })).toBeTruthy();
  expect(screen.getByText("Leu o arquivo")).toBeTruthy();
  expect(screen.queryByText(/vou chamar/i)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledWith("t1");
});

it("offers continue when the task was interrupted", async () => {
  const onContinue = vi.fn();
  render(<TaskCard task={{ ...running, state: "interrupted" }} onCancel={() => undefined} onContinue={onContinue} />);
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(onContinue).toHaveBeenCalledWith("t1");
});

it("keeps system notifications off until turned on", () => {
  const onChange = vi.fn();
  render(<NotificationSwitch enabled={false} onChange={onChange} />);
  const box = screen.getByRole("switch", { name: "System notifications" });
  expect((box as HTMLInputElement).checked).toBe(false);
});

it("has no serious axe violations in either theme", async () => {
  for (const theme of ["dark", "light"] as const) {
    document.documentElement.dataset.theme = theme;
    const view = render(
      <div>
        <TaskCard task={{ ...running, summary: "Terminou. Revise o resultado." }} onCancel={() => undefined} onContinue={() => undefined} />
        <NotificationSwitch enabled={false} onChange={() => undefined} />
      </div>,
    );
    expect(await axeViolations(view.container)).toEqual([]);
    cleanup();
  }
});
