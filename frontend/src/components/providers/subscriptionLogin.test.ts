import { describe, expect, it } from "vitest";
import { decideLogin, LOGIN_POLL_LIMIT_MS, LOGIN_POLL_MS, readSignedIn } from "./subscriptionLogin";

describe("subscription sign-in", () => {
  it("polls every 2 seconds and stops at 5 minutes or when the CLI is signed in", () => {
    expect(LOGIN_POLL_MS).toBe(2000);
    expect(decideLogin(0, false, false)).toBe("wait");
    expect(decideLogin(LOGIN_POLL_LIMIT_MS - 1, false, false)).toBe("wait");
    expect(decideLogin(LOGIN_POLL_LIMIT_MS, false, false)).toBe("timeout");
    expect(decideLogin(0, true, false)).toBe("signed-in");
    expect(decideLogin(0, false, true)).toBe("cancelled");
  });

  it("reads signed_in and ignores every other field", () => {
    expect(readSignedIn({ clis: [{ id: "claude", signed_in: true, loggedIn: false }] }, "claude")).toBe(true);
    expect(readSignedIn({ clis: [{ id: "claude", loggedIn: true }] }, "claude")).toBe(true);
    expect(readSignedIn({ clis: [{ id: "claude", signed_in: false }] }, "claude")).toBe(false);
    expect(readSignedIn({ clis: [] }, "claude")).toBe(false);
  });
});
