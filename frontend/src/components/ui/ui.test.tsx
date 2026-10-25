import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "@/test/axe";
import { Badge, Button, EmptyState, Input, Kbd, KbdChord, ListRow, Notice, Panel, Segmented, Skeleton, SkeletonRows } from ".";
import { cn } from "@/lib/utils";

afterEach(cleanup);

describe("cn", () => {
  it("keeps a font size and a colour that share the text- prefix", () => {
    expect(cn("text-body", "text-ink")).toBe("text-body text-ink");
    expect(cn("text-ink", "text-warn-text")).toBe("text-warn-text");
    expect(cn("text-body", "text-title")).toBe("text-title");
  });
  it("lets a caller override a control height", () => {
    expect(cn("h-control-md", "h-8")).toBe("h-8");
  });
});

describe("Button", () => {
  it("is a type=button by default and clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toHaveProperty("type", "button");
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps its label in layout while loading, announces it, and ignores clicks", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const b = screen.getByRole("button", { name: /Save/ });
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status", { name: "Working" })).toBeTruthy();
    // The label is `invisible` (still occupies space), never unmounted.
    expect(b.textContent).toContain("Save");
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Run</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("an icon-only button is named by aria-label", () => {
    render(<Button iconOnly aria-label="Undo" icon={<svg aria-hidden />} />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("uses the 36px touch target on narrow layouts for every size", () => {
    render(<><Button size="sm">a</Button><Button size="md">b</Button></>);
    for (const name of ["a", "b"]) expect(screen.getByRole("button", { name }).className).toContain("max-sm:h-control-lg");
  });

  it("has no axe violations in any variant", async () => {
    const { container } = render(
      <div>
        {(["primary", "secondary", "ghost", "danger"] as const).map((v) => <Button key={v} variant={v}>{v}</Button>)}
        <Button loading>Busy</Button>
        <Button disabled>Off</Button>
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Input", () => {
  it("labels the field and reserves the message row", () => {
    render(<Input label="Key" hint="Starts with sk-" />);
    const field = screen.getByLabelText("Key");
    const msg = document.getElementById(field.getAttribute("aria-describedby")!)!;
    expect(msg.textContent).toBe("Starts with sk-");
    expect(msg.className).toContain("min-h-4");
  });

  it("announces an error in place of the hint and marks the field invalid", () => {
    render(<Input label="Key" hint="Starts with sk-" error="That key was rejected" />);
    const field = screen.getByLabelText("Key");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("That key was rejected");
  });

  it("keeps an empty message row when there is nothing to say", () => {
    render(<Input label="Name" />);
    const field = screen.getByLabelText("Name");
    expect(document.getElementById(field.getAttribute("aria-describedby")!)).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBeNull();
  });

  it("sets machine data in mono", () => {
    render(<Input label="Id" mono />);
    expect(screen.getByLabelText("Id").className).toContain("font-mono");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Input label="Key" hint="h" error="e" />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Badge", () => {
  it("always carries a word and hides the marker from assistive tech", () => {
    const { container } = render(<Badge tone="warn">No model chosen</Badge>);
    expect(screen.getByText("No model chosen")).toBeTruthy();
    expect(container.querySelector("[aria-hidden]")).toBeTruthy();
    expect(container.firstElementChild!.className).toContain("text-warn-text");
  });

  it("colours a role marker from its role token", () => {
    // biome-ignore lint/a11y/useValidAriaRole: Badge's `role` is a harness role (design token), not an ARIA role
    const { container } = render(<Badge role="gate">Gate</Badge>);
    expect((container.querySelector("[aria-hidden]") as HTMLElement).style.getPropertyValue("--role")).toBe("var(--role-gate)");
  });
});

describe("Panel", () => {
  it("is a labelled region when titled", () => {
    render(<Panel title="Usage" titleId="usage-title" meta="3">body</Panel>);
    expect(screen.getByRole("region", { name: "Usage" })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Panel title="Usage" titleId="u" actions={<Button size="sm">Edit</Button>}>body</Panel>);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("ListRow", () => {
  it("marks the selected row with aria-current and reports clicks", async () => {
    const onClick = vi.fn();
    render(<ListRow title="Anthropic" meta="claude-sonnet" selected onClick={onClick} />);
    const row = screen.getByRole("button", { name: /Anthropic/ });
    expect(row.getAttribute("aria-current")).toBe("true");
    await userEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is not current when not selected", () => {
    render(<ListRow title="OpenAI" />);
    expect(screen.getByRole("button").getAttribute("aria-current")).toBeNull();
  });
});

describe("Kbd", () => {
  it("renders a chord as one keycap per key", () => {
    const { container } = render(<KbdChord caps={["Ctrl", "K"]} />);
    expect(container.querySelectorAll("kbd")).toHaveLength(2);
  });
  it("renders a single kbd", () => {
    render(<Kbd>?</Kbd>);
    expect(screen.getByText("?").tagName).toBe("KBD");
  });
});

describe("Notice", () => {
  it("announces a fault with role=alert and a title, and others politely", () => {
    const { rerender } = render(<Notice tone="fault" title="Couldn't reach the engine" action={<Button>Retry</Button>}>Retry, or open Providers.</Notice>);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach the engine");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    rerender(<Notice tone="warn" title="Check the folder" />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Notice tone="warn" title="Heads up">Detail</Notice>);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Skeleton and EmptyState", () => {
  it("announces loading once and hides the bars", () => {
    const { container } = render(<SkeletonRows rows={3} label="Loading chats" />);
    expect(screen.getByRole("status", { name: "Loading chats" })).toBeTruthy();
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(3);
    render(<Skeleton />);
  });

  it("an empty state says what is true and offers the next step", () => {
    render(<EmptyState title="No chats yet" action={<Button>New chat</Button>}>Start one and it shows up here.</EmptyState>);
    expect(screen.getByText("No chats yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
  });
});

describe("Segmented", () => {
  function Demo() {
    const [v, setV] = useState<"ask" | "auto" | "plan">("ask");
    return (
      <Segmented
        label="Permission mode"
        value={v}
        onChange={setV}
        options={[{ value: "ask", label: "Ask" }, { value: "auto", label: "Auto" }, { value: "plan", label: "Plan", disabled: true }]}
      />
    );
  }

  it("is a named radio group with one checked option and one tab stop", () => {
    render(<Demo />);
    expect(screen.getByRole("radiogroup", { name: "Permission mode" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Ask" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Auto" }).getAttribute("tabindex")).toBe("-1");
  });

  it("moves the choice with the arrow keys, skipping disabled options and wrapping", () => {
    render(<Demo />);
    const ask = screen.getByRole("radio", { name: "Ask" });
    ask.focus();
    fireEvent.keyDown(ask, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Auto" }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Auto" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Ask" }).getAttribute("aria-checked")).toBe("true");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Demo />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
