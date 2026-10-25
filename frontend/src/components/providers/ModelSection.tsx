"use client";
import { useState } from "react";
import { Chip } from "./atoms";
import { requiresModel } from "./catalog";
import { ModelPicker, modelDetail, modelSourceNote } from "./ModelPicker";
import { specOf, useProviderStore, type Connection } from "./providerStore";

/**
 * The one model setting a run reads: the connection's `defaultModel`
 * (backend/providers/resolution.py — a node's own model wins, otherwise this).
 *
 * This replaced an allow-list of ticks and an OpenRouter "route" with a
 * tie-break and a rendered request preview. None of those were ever saved or
 * sent — the sidecar runs exactly one model — so the screen showed settings
 * that did nothing and a request the app never made. One honest control
 * instead, saved to the sidecar, with the list it picks from labelled by where
 * it came from (the endpoint's own answer, or the static catalog).
 */
export function ModelSection({ c }: { c: Connection }) {
  const spec = specOf(c);
  const setDefaultModel = useProviderStore((s) => s.setDefaultModel);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "failed"; model?: string }>({ state: "idle" });
  if (spec.catalogue === "agent-only") return null;
  const required = requiresModel(spec);

  const choose = async (model: string) => {
    setSave({ state: "saving", model });
    setSave({ state: (await setDefaultModel(c.id, model)) ? "saved" : "failed", model });
  };

  return (
    <Block
      title="Models"
      chip={
        required && !c.defaultModel ? <Chip tone="warn">no model chosen</Chip> : <Chip>{c.models.length} listed</Chip>
      }
      lede={
        required
          ? "Runs on this connection use the default model unless an agent pins its own. Required: this connection refuses a run without one."
          : "Runs use the default model unless an agent pins its own. Leave it on the CLI default to let the CLI decide."
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="t-body flex-none text-ink-mute">Default model</span>
        <div className="min-w-0 max-w-[420px] flex-[1_1_16rem]">
          <ModelPicker
            connection={c}
            value={c.defaultModel}
            onChange={(m) => void choose(m)}
            label="Default model"
            inheritLabel={required ? undefined : "CLI default"}
            inheritDetail={required ? undefined : "The vendor CLI picks its own model"}
          />
        </div>
      </div>
      <div className="mt-1.5 min-h-4">
        {save.state === "saving" && <p role="status" className="t-meta text-ink-dim">Saving…</p>}
        {save.state === "saved" && (
          <p role="status" className="t-meta text-ink-dim">
            {save.model ? `Saved. Runs use ${save.model}.` : "Saved. Runs use the CLI default."}
          </p>
        )}
        {save.state === "failed" && (
          <p role="alert" className="t-meta text-fault-text">
            Couldn&apos;t save the default model. Check the app is running and try again.
          </p>
        )}
      </div>

      <p className="t-meta mb-1.5 mt-2 text-ink-mute">{modelSourceNote(c)}</p>
      {c.models.length === 0 ? (
        <p className="t-body text-ink-mute">Nothing listed yet. Test the connection to load what it serves.</p>
      ) : (
        <ul className="max-h-[260px] overflow-y-auto rounded-control border border-line-soft" aria-label={`${c.label} models`}>
          {c.models.map((m, i) => (
            <li
              key={m.id}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-[5px] ${i ? "border-t border-line-soft" : ""} ${
                m.id === c.defaultModel ? "bg-sub-200" : ""
              }`}
            >
              <span className="t-meta truncate text-ink">{m.id}</span>
              <span className="t-meta truncate text-right text-ink-mute">
                {m.id === c.defaultModel ? "default" : modelDetail(m) || "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

/* ── Cursor: what the handoff is, since there is nothing to configure ────── */

export function CursorHandoff({ c }: { c: Connection }) {
  void c;
  return (
    <Block
      title="Handoff"
      lede="Cursor runs the agent; OHarness hands it the task and reads the result back. Chat cannot use it — it answers agent tasks only."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Card
          k="Cloud agent"
          v="POST /v1/agents"
          body="Runs on Cursor's infrastructure against a connected repository. Returns an id you can poll or stream."
        />
        <Card
          k="Local CLI"
          v="cursor-agent -p --output-format stream-json"
          body="Runs on this machine under your Cursor seat, with your working tree."
        />
      </div>
    </Block>
  );
}

/* ── Shared chrome ────────────────────────────────────────────────────────── */

export function Block({
  title,
  chip,
  lede,
  children,
}: {
  title: string;
  chip?: React.ReactNode;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line-soft py-4">
      <header className="mb-2.5 flex flex-wrap items-center gap-2">
        <h2 className="t-title text-ink">{title}</h2>
        {chip}
      </header>
      {lede && <p className="t-body mb-2.5 max-w-[70ch] text-ink-mute">{lede}</p>}
      {children}
    </section>
  );
}

function Card({ k, v, body }: { k: string; v: string; body: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line-soft bg-sub-200 p-2.5">
      <div className="t-title text-ink">{k}</div>
      <div className="t-meta break-all text-ink-mute">{v}</div>
      <p className="t-body flex-1 text-ink-mute">{body}</p>
    </div>
  );
}
