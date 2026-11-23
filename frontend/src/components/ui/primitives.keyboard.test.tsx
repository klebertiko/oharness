/**
 * Keyboard and interaction contracts of the overlay primitives. Each test pins a
 * behaviour a user relies on, so removing it (an Escape handler, a value change,
 * a disabled-tab skip) fails here.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ErrorState } from "./ErrorState";
import { IconButton } from "./IconButton";
import { Menu } from "./Menu";
import { Popover } from "./Popover";
import { Select } from "./Select";
import { Tabs } from "./Tabs";
import { ToastProvider, useToast } from "./Toast";
import { Tooltip } from "./Tooltip";

beforeAll(() => {
  // Radix Select measures and captures the pointer; happy-dom has neither.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function SkipDemo() {
  const [value, setValue] = useState("one");
  return (
    <Tabs
      label="Sections"
      value={value}
      onChange={setValue}
      tabs={[
        { value: "one", label: "Overview", content: "Overview panel" },
        { value: "two", label: "Locked", content: "Locked panel", disabled: true },
        { value: "three", label: "Activity", content: "Activity panel" },
      ]}
    />
  );
}

function SelectDemo({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("alpha");
  return (
    <Select
      label="Model"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      options={[
        { value: "alpha", label: "Alpha" },
        { value: "beta", label: "Beta" },
        { value: "gamma", label: "Gamma", disabled: true },
      ]}
    />
  );
}

describe("Tabs", () => {

  it("jumps over a disabled tab with the arrow keys, both ways", async () => {
    render(<SkipDemo />);
    screen.getByRole("tab", { name: "Overview" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Locked" }).getAttribute("aria-selected")).toBe("false");
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Overview" }));
  });
});

describe("Popover", () => {
  it("opens into the panel, closes on Escape and gives focus back to the trigger", async () => {
    render(
      <Popover label="About this row" trigger={<span>Details</span>}>
        <button type="button">Inside</button>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Details" });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "About this row" })).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Inside" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("uses a button trigger as is, without nesting it in another button", async () => {
    render(
      <Popover label="Options" trigger={<IconButton label="More" icon={<svg aria-hidden />} />}>
        <p>Body</p>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "More" });
    expect(document.querySelector("button button")).toBeNull();
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Options" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Select", () => {

  it("changes the value from the list and shows the new choice", async () => {
    const onChange = vi.fn();
    render(<SelectDemo onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Model" });
    expect(trigger.textContent).toContain("Alpha");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const beta = await screen.findByRole("option", { name: "Beta" });
    fireEvent.click(beta);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("beta"));
    expect(screen.getByRole("combobox", { name: "Model" }).textContent).toContain("Beta");
  });
});

describe("Tooltip", () => {
  const tip = () => document.querySelector("[data-radix-popper-content-wrapper]")?.textContent ?? null;

  it("opens on keyboard focus and closes on Escape", async () => {
    render(
      <Tooltip label="Undo the last change">
        <IconButton label="Undo" icon={<svg aria-hidden />} />
      </Tooltip>,
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(tip()).toContain("Undo the last change"));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(tip()).toBeNull());
  });

  it("opens on hover", async () => {
    render(
      <Tooltip label="Undo the last change">
        <IconButton label="Undo" icon={<svg aria-hidden />} />
      </Tooltip>,
    );
    await userEvent.hover(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(tip()).toContain("Undo the last change"), { timeout: 1500 });
  });
});

describe("Menu", () => {
  const items = () => [
    { id: "rename", label: "Rename", onSelect: vi.fn() },
    { id: "archive", label: "Archive", disabled: true },
    { id: "delete", label: "Delete", onSelect: vi.fn() },
  ];

  it("opens from the trigger with ArrowDown onto the first item", async () => {
    render(<Menu label="Actions" items={items()} />);
    screen.getByRole("button", { name: "Actions" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
  });

  it("skips the disabled item and closes on Escape with focus back on the trigger", async () => {
    render(<Menu label="Actions" items={items()} />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when Tab moves focus out", async () => {
    render(<Menu label="Actions" items={items()} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    await userEvent.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

function ToastButton() {
  const push = useToast();
  return (
    <button type="button" onClick={() => push({ title: "Saved", body: "Your harness is on disk." })}>
      Push
    </button>
  );
}

describe("Toast", () => {
  it("lives in a region that exists before the first toast", () => {
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    );
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region.querySelector("[aria-live='polite']")).toBeTruthy();
  });

  it("pauses while focused and can be dismissed from the keyboard", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Push" }));
    const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
    dismiss.focus();
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(screen.getByText("Saved")).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("still leaves on its own when nobody holds it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Push" }));
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(screen.queryByText("Saved")).toBeNull();
  });
});

describe("ErrorState copy", () => {
  it("says Copied, then goes back to the original label", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<ErrorState title="Couldn't load" reason="No answer." diagnostic="timeout" />);
    await user.click(screen.getByRole("button", { name: "Copy diagnostic" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("button", { name: "Copy diagnostic" })).toBeTruthy();
  });
});
