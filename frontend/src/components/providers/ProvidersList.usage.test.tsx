import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProvidersList } from "./ProvidersList";
import { useUsageStore } from "./usageStore";
const initial = useUsageStore.getState();
afterEach(() => { cleanup(); useUsageStore.setState(initial, true); });
it("shows loading and failures instead of presenting unavailable usage as current", () => {
  useUsageStore.setState({ hydrated: true, loading: true });
  const view = render(<ProvidersList />);
  expect(screen.getByRole("status").textContent).toContain("Loading usage");
  useUsageStore.setState({ loading: false, error: "offline" });
  view.rerender(<ProvidersList />);
  const note = screen.getByRole("alert");
  expect(note.textContent).toContain("Usage may be out of date");
  expect(note.textContent).toContain("offline");
});
