import { describe, expect, it } from "vitest";
import { providerFault } from "./chatProvider";

/* The strings below are the ones the adapters emit (backend/adapters/*.py);
   docs/adr/0009-probe-detail-classification.md has the full table. */
const fault = (detail: string) => providerFault({ health: "fault", detail });
const setup = (detail: string) => providerFault({ health: "setup", detail });

describe("providerFault", () => {
  it.each([
    ["401 unauthorized — the key was rejected or has been revoked.", "key-rejected"],
    ["HTTP 401 from https://api.openai.com/v1.", "key-rejected"],
    ["HTTP 403 from https://api.openai.com/v1.", "key-rejected"],
    ["HTTP 402 from https://openrouter.ai/api/v1.", "out-of-credits"],
    ["HTTP 429 from https://openrouter.ai/api/v1.", "rate-limited"],
    ["HTTP 404 from https://api.openai.com/v1.", "unknown"],
    ["HTTP 503 from https://api.openai.com/v1.", "unknown"],
    ["Could not reach http://localhost:11434.", "unreachable"],
    ["https://api.openai.com/v1 did not respond in time.", "unreachable"],
  ])("fault %s -> %s", (detail, expected) => {
    expect(fault(detail)).toBe(expected);
  });

  it("CLI missing and signed-out come from health setup plus the phrase", () => {
    expect(setup("claude CLI not found on PATH. Install Claude Code, then run `claude login`.")).toBe("cli-missing");
    expect(setup("codex CLI is installed but not logged in. Run `codex login`.")).toBe("cli-signin");
    expect(setup("cursor-agent CLI is installed but not logged in. Run `cursor-agent login`.")).toBe("cli-signin");
  });

  it("anything it does not recognise is unknown, never a nearby class", () => {
    expect(fault("claude CLI did not respond to `claude auth status`.")).toBe("unknown");
    expect(fault("cursor-agent status returned unreadable output.")).toBe("unknown");
    expect(fault("Server disconnected without sending a response.")).toBe("unknown");
    expect(fault("error: not found on PATH, not logged in")).toBe("unknown");
    expect(fault("Error: HTTP 429 from the shell")).toBe("unknown");
    expect(fault("")).toBe("unknown");
  });

  it("a platform gate on a setup connection is not a fault at all", () => {
    expect(setup("Codex chat completions are not yet verified on this platform (security review).")).toBeNull();
  });

  it("a CLI phrase on a faulted connection is not trusted without health setup", () => {
    expect(fault("claude CLI not found on PATH. Install Claude Code, then run `claude login`.")).toBe("unknown");
  });

  it("healthy and probing connections have no fault", () => {
    expect(providerFault({ health: "live", detail: "HTTP 429 from x." })).toBeNull();
    expect(providerFault({ health: "probing", detail: "Could not reach x." })).toBeNull();
    expect(providerFault({ health: "degraded", detail: "" })).toBeNull();
  });
});
