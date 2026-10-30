"use client";
import type { ChatProviderTone } from "@/components/agent/chatProvider";
import type { Billing, Capability, Residence } from "./catalog";
import type { Probe } from "./providerStore";

/**
 * The marks the Providers screen adds to the shell's vocabulary. Each one
 * carries information; none of them is a decoration.
 */

/* ── Tone vocabulary ──────────────────────────────────────────────────────────
   Every coloured mark on this screen reads its colour from the readiness tone
   (`providerReadiness(c).tone`), never from raw `health`, so a turned-off
   connection that once tested live can never wear teal. Classes rather than
   inline colour, so the palette keeps its single definition site (globals.css). */
export const TONE_DOT: Record<ChatProviderTone, string> = {
  verified: "bg-signal",
  attention: "bg-warn",
  failing: "bg-fault",
  checking: "bg-ink-dim animate-pulse",
  unverified: "bg-ink-faint",
  unconfigured: "border border-ink-faint bg-transparent",
};

/** Status-word colour. Teal is reserved for interaction (design.md), so a
    verified connection reads in plain ink; only trouble takes a hue. */
export const TONE_TEXT: Record<ChatProviderTone, string> = {
  verified: "text-ink",
  attention: "text-warn-text",
  failing: "text-fault-text",
  checking: "text-ink-dim",
  unverified: "text-ink-dim",
  unconfigured: "text-ink-mute",
};

/* ── Monogram ─────────────────────────────────────────────────────────────────
   Vendor identity as a two-letter mono tile, in grey.

   Deliberately not a logo and deliberately not a brand colour. Five vendors'
   brand hues next to each other would turn the list into a rainbow and would
   collide head-on with this app's rule that chroma means *state*. `live`
   (verified, per `providerReadiness`) only deepens the hairline. */
const MONO_SIZE = {
  sm: "h-5 w-5 text-meta",
  lg: "h-8 w-8 text-title",
} as const;

export function Monogram({
  text,
  live,
  size = "sm",
}: {
  text: string;
  live?: boolean;
  size?: keyof typeof MONO_SIZE;
}) {
  return (
    <span
      aria-hidden
      className={[
        "grid flex-none place-items-center rounded-control border bg-sub-200 font-mono font-medium leading-none tracking-wide",
        MONO_SIZE[size],
        live ? "border-signal-deep text-ink-dim" : "border-line text-ink-mute",
      ].join(" ")}
    >
      {text}
    </span>
  );
}

/* ── Residence mark ───────────────────────────────────────────────────────────
   Solid square = the tokens are computed on this machine.
   Hollow square = they leave it.

   Filled versus outlined is the fastest binary the eye can resolve and needs no
   colour. The mark is visual only; `RESIDENCE_SR` carries the same fact in words. */
export const RESIDENCE_SR: Record<Residence, string> = {
  local: "runs on this machine",
  cloud: "runs in the vendor cloud",
};

export function ResidenceMark({ residence }: { residence: Residence }) {
  return (
    <span
      aria-hidden
      className={[
        "h-1.5 w-1.5 flex-none rounded-none",
        residence === "local" ? "bg-ink-dim" : "border border-ink-mute",
      ].join(" ")}
    />
  );
}

/* ── Probe trace ──────────────────────────────────────────────────────────────
   Up to twelve reachability checks as 2px bars, oldest to newest, height on a
   square-root scale so a 300ms cloud hop and a 4ms loopback both stay readable
   in the same band. A failed probe is a floor tick in fault — you can see
   *when* a provider started refusing, not just that it is refusing now. Bar
   height is data, so it is the one inline style left on this screen. */
export function ProbeTrace({
  probes,
  tone,
  height = 12,
}: {
  probes: Probe[];
  tone: ChatProviderTone;
  height?: number;
}) {
  if (!probes.length) {
    return <span aria-hidden className="h-3 w-9 flex-none border-b border-dashed border-ink-faint" />;
  }
  const max = Math.max(...probes.map((p) => p.ms), 1);
  return (
    <span aria-hidden className="flex h-3 flex-none items-end gap-px" title={`last ${probes.length} probes`}>
      {probes.map((p, i) => {
        const last = i === probes.length - 1;
        const h = p.ok ? Math.max(2, Math.round(Math.sqrt(p.ms / max) * height)) : 2;
        return (
          <span
            key={i}
            className={`w-0.5 rounded-none ${!p.ok ? "bg-fault" : last ? TONE_DOT[tone] : "bg-ink-faint"}`}
            style={{ height: h }}
          />
        );
      })}
    </span>
  );
}

/* ── State rule ───────────────────────────────────────────────────────────────
   The 2px vertical rule that opens a connection row in the run binding. */
export function StateRule({ tone, tall }: { tone: ChatProviderTone; tall?: boolean }) {
  return (
    <span
      aria-hidden
      className={`w-0.5 flex-none rounded-none ${tall ? "h-6.5" : "h-4.5"} ${TONE_DOT[tone]}`}
    />
  );
}

/* ── Label tables used by more than one component ─────────────────────────── */

export const CAP_WORD: Record<Capability, string> = {
  chat: "completion",
  agent: "delegation",
  embed: "embedding",
};

export const BILL_WORD: Record<Billing, string> = {
  subscription: "seat",
  credits: "credits",
  metered: "per token",
  none: "free",
};
