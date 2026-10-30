import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueuedMessages } from "./QueuedMessages";

afterEach(cleanup);
const items = [{ id: "1", text: "run the tests" }, { id: "2", text: "then summarize" }];

it("lists what is waiting, in order, and says when it runs", () => {
  render(<QueuedMessages items={items} paused={false} onRemove={vi.fn()} onClear={vi.fn()} onSendNext={vi.fn()} />);
  const region = screen.getByRole("region", { name: "Queued messages" });
  expect(region.textContent).toContain("runs after the current turn");
  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("run the tests"), expect.stringContaining("then summarize")]);
});

it("each message can be removed, by name", () => {
  const onRemove = vi.fn();
  render(<QueuedMessages items={items} paused={false} onRemove={onRemove} onClear={vi.fn()} onSendNext={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove queued message: then summarize" }));
  expect(onRemove).toHaveBeenCalledWith("2");
});

it("renders nothing when the queue is empty", () => {
  const { container } = render(<QueuedMessages items={[]} paused={false} onRemove={vi.fn()} onClear={vi.fn()} onSendNext={vi.fn()} />);
  expect(container.textContent).toBe("");
});

it("when paused it says why and offers Send next and Clear queue", () => {
  const onSendNext = vi.fn(); const onClear = vi.fn();
  render(<QueuedMessages items={items} paused onRemove={vi.fn()} onClear={onClear} onSendNext={onSendNext} />);
  expect(screen.getByRole("region", { name: "Queued messages" }).textContent).toMatch(/paused/i);
  fireEvent.click(screen.getByRole("button", { name: "Send next" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear queue" }));
  expect(onSendNext).toHaveBeenCalledTimes(1);
  expect(onClear).toHaveBeenCalledTimes(1);
});
