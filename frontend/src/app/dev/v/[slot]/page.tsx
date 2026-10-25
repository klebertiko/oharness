"use client";
import { use } from "react";
import { ASSIGN } from "../assign";
import CanvasBench from "../../canvas/page";

/**
 * Blind comparison slot. Both candidates are served from this one origin and
 * this one route shape so nothing outside the rendered pixels distinguishes
 * them.
 */
export default function Slot({ params }: { params: Promise<{ slot: string }> }) {
  const { slot } = use(params);
  const which = ASSIGN[slot];

  if (which === "live") return <CanvasBench />;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--sub-000)",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: dev-only reference overlay of a static bitmap, not an app image */}
      <img
        src="/ref/bar.png"
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />
    </div>
  );
}
