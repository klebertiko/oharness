"use client";
import { NiloSprite, type NiloState } from "@/components/brand/NiloSprite";
import { ThinkingStatus } from "@/components/brand/ThinkingStatus";

const STATES: NiloState[] = ["idle", "thinking", "working", "waiting", "success", "error", "sleeping"];

/** Dev gallery: every Nilo state, live. The first one is interactive. */
export default function NiloGallery() {
  return (
    <main className="min-h-screen bg-sub-000 p-10 text-ink">
      <h1 className="text-[20px] font-semibold">Nilo</h1>
      <p className="mt-1 text-title text-ink-mute">Every state, live. Click the first one; move the pointer around it.</p>
      <div className="mt-8 flex flex-wrap items-end gap-10">
        {STATES.map((s, i) => (
          <figure key={s} className="flex flex-col items-center gap-2">
            <NiloSprite state={s} cell={6} interactive={i === 0} label={`Nilo, ${s}`} />
            <figcaption className="font-mono text-meta text-ink-mute">{s}</figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-10 flex flex-col gap-4">
        <ThinkingStatus state="thinking" detail="Walking the harness graph." />
        <ThinkingStatus state="working" />
        <ThinkingStatus state="waiting" detail="A gate needs your approval." />
      </div>
    </main>
  );
}
