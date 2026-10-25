"use client";

/**
 * The one expand/collapse control for a run's step-by-step detail. A real
 * <button> (keyboard-operable, Space/Enter for free) that states whether it is
 * expanded and which region it controls. Shared by the stage-level toggle for
 * a run still in flight and the per-message toggle for a saved one, so both
 * speak the same words and expose the same semantics.
 */
export function RunDetailToggle({
  open,
  onToggle,
  controlsId,
}: {
  open: boolean;
  onToggle: () => void;
  /** id of the region this button reveals; only resolves while it is open. */
  controlsId: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controlsId}
      className="self-start rounded-control text-body text-ink-mute underline-offset-2 hover:text-ink-mute hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
    >
      {open ? "Hide run detail" : "Show run detail"}
    </button>
  );
}

/** The revealed detail, labelled so assistive tech can land on it. */
export function RunDetailRegion({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      role="region"
      aria-label="Run detail"
      className="overflow-hidden rounded-panel border border-line bg-sub-100"
    >
      {children}
    </div>
  );
}
