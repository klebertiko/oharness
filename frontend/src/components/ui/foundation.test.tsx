import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { axeViolations } from "@/test/axe";
import { Button, ConfirmInline, Input, ListRow, StatusMark } from ".";

afterEach(() => {
  cleanup();
  useLocaleStore.setState({ locale: "en" });
});

describe("touch targets (ADR 0033)", () => {
  it("raise Button, Input and ListRow to control-touch under a coarse pointer, and leave mouse heights alone", () => {
    render(
      <>
        <Button size="sm">a</Button>
        <Button iconOnly aria-label="b">x</Button>
        <Input label="c" />
        <ListRow title="d" />
      </>,
    );
    expect(screen.getByRole("button", { name: "a" }).className).toContain("h-control-sm");
    expect(screen.getByRole("button", { name: "a" }).className).toContain("pointer-coarse:h-control-touch");
    expect(screen.getByRole("button", { name: "b" }).className).toContain("pointer-coarse:w-control-touch");
    expect(screen.getByLabelText("c").className).toContain("pointer-coarse:h-control-touch");
    expect(screen.getByRole("button", { name: "d" }).className).toContain("pointer-coarse:min-h-control-touch");
  });
});

describe("StatusMark", () => {
  it("is decorative and square", () => {
    const { container } = render(<StatusMark tone="fault" />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.className).toContain("rounded-none");
    expect(mark.className).toContain("bg-fault");
  });

  it("pulse stops under reduced motion", () => {
    const { container } = render(<StatusMark tone="busy" />);
    expect((container.firstElementChild as HTMLElement).className).toContain("motion-reduce:animate-none");
  });
});

describe("ConfirmInline", () => {
  it("puts focus on Cancel, names the action, and confirms only on the named button", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmInline prompt="Remove the saved key?" confirmLabel="Remove key" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(await axeViolations(screen.getByRole("group").parentElement as HTMLElement)).toEqual([]);
  });

  it("Escape cancels, unless it is busy", () => {
    const onCancel = vi.fn();
    const { rerender } = render(<ConfirmInline prompt="Sure?" confirmLabel="Remove key" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("group"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    rerender(<ConfirmInline prompt="Sure?" confirmLabel="Remove key" busy onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("group"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("speaks the app's language", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    render(<ConfirmInline prompt="Remover a chave?" confirmLabel="Remover a chave" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });
});
