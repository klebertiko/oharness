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

/** One readiness dot. Hollow when nothing is configured, filled once there is
    something to report — the same filled/hollow grammar as the residence mark. */
export function ToneDot({ tone }: { tone: ChatProviderTone }) {
  return <span aria-hidden className={`h-[7px] w-[7px] flex-none rounded-none ${TONE_DOT[tone]}`} />;
}

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
        "grid flex-none place-items-center rounded-control border bg-sub-200 font-mono font-medium leading-none tracking-[0.04em]",
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
        "h-[6px] w-[6px] flex-none rounded-none",
        residence === "local" ? "bg-ink-dim" : "border border-ink-mute",
      ].join(" ")}
    />
  );
}

/* ── Fact ─────────────────────────────────────────────────────────────────────
   One line of the dossier's spec sheet: a sentence-case term, its value and an
   optional note, as `dt`/`dd` inside the parent `dl`. Each fact is ruled on top
   rather than on the left, so the sheet can reflow into as many columns as the
   dossier is wide — one column on a phone, five on a desktop — instead of
   squeezing fixed columns until their text overlaps. */
const FACT_TONE = {
  ink: "text-ink",
  warn: "text-warn-text",
  fault: "text-fault-text",
} as const;

export function Fact({
  term,
  value,
  mark,
  tone = "ink",
  note,
}: {
  term: string;
  value: string;
  mark?: React.ReactNode;
  tone?: keyof typeof FACT_TONE;
  note?: string;
}) {
  return (
    <div className="min-w-0 border-t border-line-soft pt-2">
      <dt className="t-body text-ink-mute">{term}</dt>
      <dd
        className={`t-title mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 [overflow-wrap:anywhere] ${FACT_TONE[tone]}`}
      >
        {mark}
        {value}
      </dd>
      {note && <dd className="t-body mt-0.5 text-ink-mute [overflow-wrap:anywhere]">{note}</dd>}
    </div>
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
    return <span aria-hidden className="h-3 w-[35px] flex-none border-b border-dashed border-ink-faint" />;
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
            className={`w-[2px] rounded-none ${!p.ok ? "bg-fault" : last ? TONE_DOT[tone] : "bg-ink-faint"}`}
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
      className={`w-[2px] flex-none rounded-none ${tall ? "h-[26px]" : "h-[18px]"} ${TONE_DOT[tone]}`}
    />
  );
}

/* ── Chip ─────────────────────────────────────────────────────────────────────
   Squared, hairline, mono. Not a pill — design.md caps controls at 7px. */
const CHIP_TONE = {
  dim: "text-ink-dim",
  signal: "text-signal-text",
  warn: "text-warn-text",
  fault: "text-fault-text",
} as const;

export function Chip({
  children,
  tone = "dim",
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  tone?: keyof typeof CHIP_TONE;
  onClick?: () => void;
  title?: string;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      aria-pressed={onClick && active !== undefined ? active : undefined}
      className={[
        "t-meta inline-flex h-[19px] items-center gap-1.5 whitespace-nowrap rounded-control border px-1.5 transition-colors",
        CHIP_TONE[tone],
        active ? "border-signal-deep bg-sub-300" : "border-line bg-sub-200",
        onClick
          ? "hover:border-ink-faint hover:bg-sub-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
          : "",
      ].join(" ")}
    >
      {children}
    </Tag>
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
