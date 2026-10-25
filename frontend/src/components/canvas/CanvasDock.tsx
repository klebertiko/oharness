"use client";
import { useEffect, useState } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { Minus, Plus, Maximize2, Grid2x2, Hand, Lock, Unlock, Network } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { chordCaps, useIsMac } from "@/components/shell/keys";
import type { LucideIcon } from "lucide-react";

/**
 * Viewport dock — bottom centre, floating.
 *
 * The library's stock <Controls> is a vertical stack of four grey squares in a
 * corner, which is where nobody's hand is. This is one horizontal strip on the
 * centre line, with the zoom stated as a number you can read rather than
 * inferred from how big things look. Snap and pan-lock live here too because
 * they are viewport facts, not document facts, and the toolbar upstairs is for
 * document verbs only.
 */

function DockButton({
  icon: Icon,
  label,
  onClick,
  active,
  ariaLabel,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  /** Accessible name when the tooltip carries extra text (a shortcut). */
  ariaLabel?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={ariaLabel ?? label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`oh-focus-inner grid h-6 w-7 place-items-center transition-colors hover:bg-sub-300 disabled:pointer-events-none disabled:opacity-30 ${
        active ? "bg-sub-400 text-signal-text" : "text-ink-mute hover:text-ink"
      }`}
    >
      <Icon size={13} strokeWidth={1.6} absoluteStrokeWidth />
    </button>
  );
}

/** Chord for "Auto-arrange graph" (keys.ts spec; also bound in app/page.tsx). */
export const ARRANGE_CHORD = "Shift+L";

const Rule = () => <span className="my-[4px] w-px flex-none bg-line-soft" aria-hidden />;

interface Props {
  snap: boolean;
  onSnap: (v: boolean) => void;
  locked: boolean;
  onLock: (v: boolean) => void;
  panMode: boolean;
  onPanMode: (v: boolean) => void;
}

export function CanvasDock({ snap, onSnap, locked, onLock, panMode, onPanMode }: Props) {
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const [flash, setFlash] = useState(false);
  const mac = useIsMac();
  const arrangeGraph = useCanvasStore((s) => s.arrangeGraph);
  const canArrange = useCanvasStore((s) => s.nodes.length > 1 && !s.isRunning);

  /* The zoom readout doubles as a reset: clicking it snaps back to 100%. That
     needs a moment of acknowledgement, or the click feels like it missed. */
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(false), 220);
    return () => window.clearTimeout(t);
  }, [flash]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[10px] z-10 flex justify-center">
      <div className="oh-float pointer-events-auto flex h-7 items-stretch overflow-hidden">
        <DockButton icon={Minus} label="Zoom out" onClick={() => zoomOut({ duration: 140 })} />
        <button
          type="button"
          title="Reset zoom to 100%"
          aria-label={`Reset zoom, now ${Math.round(zoom * 100)}%`}
          onClick={() => {
            zoomTo(1, { duration: 140 });
            setFlash(true);
          }}
          className={`oh-focus-inner t-meta grid w-[46px] place-items-center border-x border-line-soft transition-colors hover:bg-sub-300 hover:text-ink ${
            flash ? "text-signal-text" : "text-ink-dim"
          }`}
        >
          {Math.round(zoom * 100)}%
        </button>
        <DockButton icon={Plus} label="Zoom in" onClick={() => zoomIn({ duration: 140 })} />
        <Rule />
        <DockButton
          icon={Maximize2}
          label="Fit graph to view"
          onClick={() => fitView({ padding: 0.22, duration: 220 })}
        />
        <DockButton
          icon={Network}
          label={`Auto-arrange graph · ${chordCaps(ARRANGE_CHORD, mac).join(" ")}`}
          ariaLabel="Auto-arrange graph"
          disabled={!canArrange}
          onClick={arrangeGraph}
        />
        <DockButton
          icon={Hand}
          label={panMode ? "Pan tool on — drag anywhere to move the canvas" : "Pan tool — drag to move the canvas without selecting"}
          active={panMode}
          onClick={() => onPanMode(!panMode)}
        />
        <DockButton
          icon={Grid2x2}
          label="Snap to grid"
          active={snap}
          onClick={() => onSnap(!snap)}
        />
        <DockButton
          icon={locked ? Lock : Unlock}
          label={locked ? "Unlock the canvas" : "Lock the canvas"}
          active={locked}
          onClick={() => onLock(!locked)}
        />
      </div>
    </div>
  );
}
