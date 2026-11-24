import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useShellStore, LEFT_MIN, RAIL_COLLAPSED } from "./shellStore";
import { ActivityRail } from "./ActivityRail";

beforeEach(() => {
  useShellStore.setState({ hydrated: true, leftWidth: 216 });
});
afterEach(cleanup);

it("uses the saved left width when the panel is not suppressed", () => {
  render(<ActivityRail />);
  const nav = screen.getByRole("navigation", { name: "Destinations" });
  expect(nav.style.width).toBe("216px");
  expect(nav.style.minWidth).toBe(`${LEFT_MIN}px`);
});

it("shrinks to the icon-only width when the left panel is suppressed", () => {
  render(<ActivityRail collapsed />);
  const nav = screen.getByRole("navigation", { name: "Destinations" });
  expect(nav.style.width).toBe(`${RAIL_COLLAPSED}px`);
  expect(nav.style.minWidth).toBe(`${RAIL_COLLAPSED}px`);
});

/* The theme button must agree with what is on screen. `system` is the default and follows the OS,
   so the button resolves it before deciding what a click does; it never offers the theme already shown. */
describe("theme button", () => {
  const prefersLight = (light: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("light") ? light : !light,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  };
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("on system with a dark OS, offers light and the first click shows light", () => {
    prefersLight(false);
    document.documentElement.dataset.theme = "system";
    render(<ActivityRail />);
    fireEvent.click(screen.getByRole("button", { name: "Use light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Follow system theme" })).toBeTruthy();
  });

  it("on system with a light OS, offers dark and the first click shows dark", () => {
    prefersLight(true);
    document.documentElement.dataset.theme = "system";
    render(<ActivityRail />);
    fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("from an explicit choice that differs from the OS, goes back to system", () => {
    prefersLight(false);
    document.documentElement.dataset.theme = "light";
    render(<ActivityRail />);
    fireEvent.click(screen.getByRole("button", { name: "Follow system theme" }));
    expect(document.documentElement.dataset.theme).toBe("system");
    expect(screen.getByRole("button", { name: "Use light theme" })).toBeTruthy();
  });

  it("from an explicit choice equal to the OS, offers the other theme", () => {
    prefersLight(true);
    document.documentElement.dataset.theme = "light";
    render(<ActivityRail />);
    fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
