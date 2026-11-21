import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { useShellStore } from "./shellStore";

afterEach(cleanup);

it("names every destination in the open sidebar", () => {
  useShellStore.setState({ section: "chats", hydrated: true });
  render(<Sidebar variant="open" />);
  for (const name of ["Chats", "Forja", "Studio", "Plugins", "Providers", "Settings"]) {
    expect(screen.getByRole("button", { name })).toBeTruthy();
  }
  expect(screen.getByRole("button", { name: "New session" })).toBeTruthy();
});

it("keeps the destination names on the icon strip", () => {
  useShellStore.setState({ section: "studio", hydrated: true });
  render(<Sidebar variant="rail" />);
  expect(screen.getByRole("button", { name: "Studio" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: "Chats" }).getAttribute("aria-current")).toBeNull();
});
