import { PROVIDERS_BIND_NONE } from "./copy";
import { expect, test } from "vitest";

test("bind placeholder does not mention Wallet", () => {
  expect(PROVIDERS_BIND_NONE.toLowerCase()).not.toContain("wallet");
  expect(PROVIDERS_BIND_NONE).toContain("Providers");
});
