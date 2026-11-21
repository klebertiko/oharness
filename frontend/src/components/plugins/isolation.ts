/** How a capability is limited, matching the host: network is declared, the other three are enforced unless accepted. */

export const CAPABILITIES = ["files", "network", "processes", "credentials"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type CapabilityNote = "enforced" | "granted" | "declared" | "notEnforced";

export function capabilityNote(runtime: string, capability: Capability, enabled: boolean): CapabilityNote {
  if (runtime === "in-process") return "notEnforced";
  if (capability === "network") return "declared";
  return enabled ? "granted" : "enforced";
}
