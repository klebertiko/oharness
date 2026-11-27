import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "@/test/axe";
import { useRetained, useSpinner } from "./async";
import { Checkbox } from "./Checkbox";
import { ErrorState } from "./ErrorState";
import { IconButton } from "./IconButton";
import { Menu } from "./Menu";
import { Switch } from "./Switch";
import { Tabs } from "./Tabs";
import { Textarea } from "./Textarea";
import { ToastProvider, useToast } from "./Toast";

afterEach(cleanup);

function SwitchDemo() {
  const [on, setOn] = useState(false);
  return <Switch label="Worktree" checked={on} onCheckedChange={setOn} />;
}

function TabsDemo() {
  const [value, setValue] = useState("one");
  return (
    <Tabs
      label="Sections"
      value={value}
      onChange={setValue}
      tabs={[
        { value: "one", label: "Overview", content: "Overview panel" },
        { value: "two", label: "Activity", content: "Activity panel" },
        { value: "three", label: "Locked", content: "Hidden", disabled: true },
      ]}
    />
  );
}

function RetainedProbe({ value, failed }: { value?: string; failed: boolean }) {
  return <span>{useRetained(value, failed) ?? "empty"}</span>;
}

function SpinnerDemo({ active }: { active: boolean }) {
  return <span>{useSpinner(active, 400) ? "shown" : "hidden"}</span>;
}

describe("IconButton, Textarea, Checkbox, Switch, Tabs", () => {
  it("names an icon button and ignores a disabled press", async () => {
    const onClick = vi.fn();
    render(<IconButton label="Undo" disabled onClick={onClick} icon={<svg aria-hidden />} />);
    const button = screen.getByRole("button", { name: "Undo" });
    expect(button.getAttribute("title")).toBe("Undo");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("announces a textarea error", () => {
    render(<Textarea label="Notes" error="Write what changed." />);
    expect(screen.getByLabelText("Notes").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Write what changed.");
  });

  it("checks, mixes and disables a checkbox", () => {
    render(
      <>
        <Checkbox label="Save a copy" defaultChecked />
        <Checkbox label="Some selected" indeterminate />
        <Checkbox label="Locked" disabled />
      </>,
    );
    expect((screen.getByLabelText("Save a copy") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Some selected").getAttribute("aria-checked")).toBe("mixed");
    expect(screen.getByLabelText("Locked")).toHaveProperty("disabled", true);
  });

  it("toggles a switch from the keyboard", async () => {
    render(<SwitchDemo />);
    const sw = screen.getByRole("switch", { name: "Worktree" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    sw.focus();
    await userEvent.keyboard(" ");
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("moves tabs with the arrows and skips a disabled tab", async () => {
    render(<TabsDemo />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("Activity panel");
  });
});

describe("Menu", () => {
  const items = [
    { id: "rename", label: "Rename", onSelect: vi.fn() },
    { id: "skip", label: "Archive", disabled: true },
    { id: "move", label: "Move", items: [{ id: "inbox", label: "Inbox", onSelect: vi.fn() }] },
  ];

  it("opens, arrows into a submenu and chooses", async () => {
    const onSelect = vi.fn();
    render(<Menu label="Actions" items={[{ ...items[2], items: [{ id: "inbox", label: "Inbox", onSelect }] }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    const move = screen.getByRole("menuitem", { name: "Move" });
    move.focus();
    fireEvent.keyDown(move, { key: "ArrowRight" });
    const inbox = screen.getByRole("menuitem", { name: "Inbox" });
    expect(inbox).toBeTruthy();
    fireEvent.keyDown(inbox, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe("ErrorState", () => {
  it("says what failed, why, and offers the three actions", async () => {
    const onRetry = vi.fn();
    const write = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(write);
    render(<ErrorState title="Couldn't load chats" reason="The sidecar did not answer." diagnostic="timeout" onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load chats");
    expect(screen.getByRole("alert").textContent).toContain("The sidecar did not answer.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Open details" }));
    expect(screen.getByText("timeout")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Copy diagnostic" }));
    expect(write).toHaveBeenCalledWith("timeout");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(await axeViolations(screen.getByRole("alert"))).toEqual([]);
  });
});

function ToastButton() {
  const push = useToast();
  return <button type="button" onClick={() => push({ title: "Saved", tone: "info" })}>Push</button>;
}

describe("Toast and retained content", () => {
  it("announces a toast", async () => {
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Push" }));
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });

  it("keeps the previous value when a refresh fails", () => {
    const view = render(<RetainedProbe value="chats" failed={false} />);
    expect(screen.getByText("chats")).toBeTruthy();
    view.rerender(<RetainedProbe value={undefined} failed />);
    expect(screen.getByText("chats")).toBeTruthy();
  });
});

describe("useSpinner", () => {
  it("waits before showing and then holds", () => {
    vi.useFakeTimers();
    const view = render(<SpinnerDemo active />);
    expect(screen.getByText("hidden")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText("shown")).toBeTruthy();
    view.rerender(<SpinnerDemo active={false} />);
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.getByText("shown")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("hidden")).toBeTruthy();
    vi.useRealTimers();
  });
});
