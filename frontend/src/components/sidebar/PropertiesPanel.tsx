"use client";
import { Children, cloneElement, isValidElement, useId } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import styles from "@/components/canvas/canvas.module.css";
import { useCanvasStore } from "@/store/canvasStore";
import { Panel } from "@/components/shell/Panel";
import { chordCaps, useIsMac } from "@/components/shell/keys";
import { ROLE_CODE, ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import { PORTS } from "@/lib/ports";
import { ASSISTABLE } from "@/lib/copilot/catalog";
import type { AssistField } from "@/lib/copilot/contract";
import { AssistRow, AssistToggle, useFieldAssist } from "./FieldAssist";
import type { NodeData, AdapterType, NodeType } from "@/lib/types";
import { PROVIDERS_BIND_NONE } from "@/components/providers/copy";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { providerReadiness } from "@/components/agent/chatProvider";
import { ModelPicker } from "@/components/providers/ModelPicker";
import { requiresModel } from "@/components/providers/catalog";
import { specOf } from "@/components/providers/providerStore";
import { Combobox, type ComboOption } from "@/components/ui/Combobox";
import { connectionLabel } from "@/components/agent-run/pinnedConnection";

/* ═══════════════════════════════════════════════════════════════════════════
   The inspector.

   Same fields as before; the change is that they are now under section
   kickers that match the palette's, and the panel opens with two things the
   old one never showed: an identity block that tells you *what kind of thing*
   you selected, and the node's live port table with wired state. Editing a
   node's model without being able to see what it is connected to is how you
   end up debugging a graph in the JSON export.
   ═══════════════════════════════════════════════════════════════════════════ */

const ADAPTERS: AdapterType[] = ["mock", "claude", "ollama", "openai", "lmstudio", "codex"];

const inputCls =
  `${styles.fieldControl} w-full rounded-control border border-line-strong bg-sub-200 px-2 py-1 text-title text-ink transition-colors hover:bg-sub-300`;
const textareaCls = `${inputCls} h-[76px] resize-none text-body leading-relaxed`;

/** Picker trigger styled like the inspector's other fields. */
const pickerCls = `${inputCls} h-8 justify-between text-left`;

/** The shared readiness word, guarded for a row the catalog does not know. */
function readinessWord(c: Connection): string {
  return specOf(c) ? providerReadiness(c).label : c.enabled ? "On" : "Not connected";
}

function SectionHead({ label, note }: { label: string; note?: string }) {
  return (
    <div className="flex min-h-panelhead items-center gap-2 border-y border-line-soft bg-sub-000 px-2.5">
      <span className="t-label flex-none text-ink-dim">{label}</span>
      {note && <span className="t-body min-w-0 flex-1 truncate text-ink-mute">{note}</span>}
    </div>
  );
}

function Field({
  label,
  action,
  below,
  children,
}: {
  label: string;
  /** Right-aligned control in the label row (e.g. Assist). */
  action?: React.ReactNode;
  /** Content under the control (e.g. the Assist row). */
  below?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  const labelEl = <label htmlFor={id} className="t-title block text-ink-dim">{label}</label>;
  return (
    <div className="space-y-1">
      {action ? (
        <div className="flex items-center justify-between gap-2">
          {labelEl}
          {action}
        </div>
      ) : (
        labelEl
      )}
      {Children.map(children, (child) =>
        isValidElement<{ id?: string }>(child) &&
        ["input", "select", "textarea"].includes(String(child.type))
          ? cloneElement(child, { id })
          : child
      )}
      {below}
    </div>
  );
}

/** A Field that offers inline assist when the catalogue says this field is assistable. */
function AssistedField({ nodeId, nodeType, field, label, children }: { nodeId: string; nodeType: NodeType; field: AssistField; label: string; children: React.ReactNode }) {
  const ctl = useFieldAssist(nodeId, field);
  if (!ASSISTABLE[nodeType]?.includes(field)) return <Field label={label}>{children}</Field>;
  return (
    <Field label={label} action={<AssistToggle ctl={ctl} />} below={<AssistRow ctl={ctl} />}>
      {children}
    </Field>
  );
}

/** The node's wiring, read straight off the graph. */
function PortTable({ nodeId, type }: { nodeId: string; type: NodeType }) {
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const nameOf = (id: string) => String(nodes.find((n) => n.id === id)?.data.label ?? id);

  const rows = [
    ...PORTS[type].in.map((p) => {
      const wires = edges.filter((e) => e.target === nodeId && (e.targetHandle ?? "in") === p.id);
      return { key: `in-${p.id}`, dir: "in" as const, port: p, wires };
    }),
    ...PORTS[type].out.map((p) => {
      const wires = edges.filter((e) => e.source === nodeId && (e.sourceHandle ?? "out") === p.id);
      return { key: `out-${p.id}`, dir: "out" as const, port: p, wires };
    }),
  ];

  return (
    <div className="px-2.5 py-2">
      {rows.map((r) => {
        const tone =
          r.port.tone === "accept"
            ? "var(--signal-text)"
            : r.port.tone === "reject"
              ? "var(--fault-text)"
              : "var(--ink-mute)";
        const wired = r.wires.length > 0;
        return (
          <div key={r.key} className="flex items-center gap-2 py-[3px]">
            <span
              aria-hidden
              className="h-[10px] w-[3px] flex-none rounded-none"
              style={{
                background: wired ? tone : "transparent",
                boxShadow: wired ? "none" : `inset 0 0 0 1px var(--line)`,
              }}
            />
            <span className="t-meta w-[24px] flex-none text-ink-mute">{r.dir}</span>
            <span className="t-meta w-[56px] flex-none truncate" style={{ color: tone }}>
              {r.port.label}
            </span>
            <span className="t-body min-w-0 flex-1 truncate text-right text-ink-mute">
              {wired ? r.wires.map((w) => nameOf(r.dir === "in" ? w.source : w.target)).join(", ") : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * `providerIds[1:]` — PROVIDER-FAILOVER story, AC#5. The primary pin (index
 * 0, `Field label="Connection pin"` above) is edited elsewhere; this manages
 * only the ordered fallback chain the engine walks when the pin above fails
 * to resolve or errors before any output reaches the person (never once it
 * has — that boundary is backend/engine.py's, not authored here). Nothing to
 * fail over *to* without a primary pin, so this renders nothing without one;
 * clearing the pin already discards the whole array (existing behaviour,
 * untouched by this story).
 */
function FallbackConnections({
  providerIds,
  connections,
  onChange,
}: {
  providerIds: string[];
  connections: Connection[];
  onChange: (ids: string[]) => void;
}) {
  const primary = providerIds[0];
  if (!primary) return null;
  const fallbacks = providerIds.slice(1);
  const used = new Set(providerIds);
  const available = connections.filter((c) => !used.has(c.id));

  const setFallbacks = (next: string[]) => onChange([primary, ...next]);
  const addFallback = (id: string) => {
    if (!id || used.has(id)) return;
    setFallbacks([...fallbacks, id]);
  };
  const removeFallback = (index: number) => setFallbacks(fallbacks.filter((_, i) => i !== index));
  const moveFallback = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= fallbacks.length) return;
    const next = [...fallbacks];
    [next[index], next[target]] = [next[target], next[index]];
    setFallbacks(next);
  };

  return (
    <Field label="Fallback connections">
      <div className="space-y-1">
        {fallbacks.length === 0 && (
          <p className="t-meta leading-4 text-ink-mute">
            None configured — a resolution or first-output failure on the pin above stops the run today.
          </p>
        )}
        {fallbacks.map((id, i) => {
          const label = connectionLabel(connections, id);
          return (
            <div key={id} className="flex items-center gap-1.5">
              <span className="t-meta w-4 flex-none text-right text-ink-mute">{i + 2}</span>
              <span className="t-body min-w-0 flex-1 truncate text-ink">{label}</span>
              <button
                type="button"
                className="rounded-control p-0.5 text-ink-mute hover:bg-sub-300 hover:text-ink-dim active:bg-sub-400 disabled:pointer-events-none disabled:opacity-30"
                disabled={i === 0}
                aria-label={`Move ${label} up`}
                onClick={() => moveFallback(i, -1)}
              >
                <ArrowUp size={12} strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                className="rounded-control p-0.5 text-ink-mute hover:bg-sub-300 hover:text-ink-dim active:bg-sub-400 disabled:pointer-events-none disabled:opacity-30"
                disabled={i === fallbacks.length - 1}
                aria-label={`Move ${label} down`}
                onClick={() => moveFallback(i, 1)}
              >
                <ArrowDown size={12} strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                className="rounded-control p-0.5 text-ink-mute hover:bg-sub-300 hover:text-ink-dim active:bg-sub-400"
                aria-label={`Remove ${label} fallback`}
                onClick={() => removeFallback(i)}
              >
                <X size={12} strokeWidth={2} aria-hidden />
              </button>
            </div>
          );
        })}
        {available.length > 0 && (
          <Combobox
            label="Add fallback connection"
            triggerLabel="Add fallback connection"
            value={null}
            options={available.map((c) => ({ id: c.id, label: c.label, detail: readinessWord(c) }))}
            onChange={addFallback}
            triggerClassName={pickerCls}
            trigger={<span className="min-w-0 truncate text-ink-mute">+ Add fallback connection…</span>}
          />
        )}
      </div>
      <p className="t-meta mt-1 leading-4 text-ink-dim">
        Tried in this order only if the pin above fails to resolve or errors before any output —
        never a silent swap. The Transcript marks any node this happens on.
      </p>
    </Field>
  );
}

export function PropertiesPanel() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const connections = useProviderStore((s) => s.connections);
  const mac = useIsMac();
  const providerHintId = useId();
  const node = nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <Panel title="Inspector" className="h-full">
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6">
          <p className="text-center text-title font-semibold text-ink-dim">Select a block</p>
          <p className="max-w-[190px] text-center text-body leading-5 text-ink-mute">
            Inspect its connections and edit its settings here. Add a block from the Blocks panel to get started.
          </p>
          <p className="t-meta flex items-center gap-1.5 text-ink-mute">
            select a block, or
            {chordCaps("Mod+K", mac).map((c) => (
              <kbd key={c} className="oh-kbd">
                {c}
              </kbd>
            ))}
          </p>
        </div>
      </Panel>
    );
  }

  const type = node.type as NodeType;
  const Icon = ROLE_ICON[type];
  const role = ROLE_VAR[type];
  const d = node.data as NodeData;
  const update = (patch: Partial<NodeData>) => updateNodeData(node.id, patch);
  const isModel = ["agent", "skill"].includes(node.type);
  const sealed = connections.filter((c) => c.secret);
  const pin = d.providerIds?.[0];
  const pinned = pin ? connections.find((c) => c.id === pin) : undefined;
  const pinOptions: ComboOption[] = [
    { id: "", label: "Use chat default (in chat)", detail: "Unpinned agents use the chat provider" },
    ...(pin && !pinned ? [{ id: pin, label: pin, detail: "Removed under Providers" }] : []),
    ...connections.map((c) => ({ id: c.id, label: c.label, detail: readinessWord(c) })),
  ];
  // What "Connection default" will actually resolve to, said up front.
  const inheritDetail = !pinned
    ? "The chat provider's default model"
    : pinned.defaultModel ||
      (specOf(pinned) && requiresModel(specOf(pinned))
        ? "None set: runs on this connection fail until one is chosen"
        : "The vendor CLI's own default");

  return (
    <Panel
      title="Inspector"
      meta={ROLE_CODE[type]}
      className="h-full"
      actions={
        <span
          className="ml-1 h-[12px] w-[2px] rounded-none"
          style={{ background: role }}
          aria-hidden
        />
      }
    >
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-2.5 py-2.5">
        <span
          aria-hidden
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded-none"
          style={{
            background: "color-mix(in oklab, var(--role-c) 18%, var(--sub-200))",
            ["--role-c" as string]: role,
            color: role,
          }}
        >
          <Icon size={13} strokeWidth={1.8} absoluteStrokeWidth />
        </span>
        <div className="min-w-0 flex-1">
          <div className="t-title truncate text-ink">{String(d.label ?? node.id)}</div>
          <div className="t-meta truncate text-ink-mute">{node.id}</div>
        </div>
      </div>

      <SectionHead label="Wiring" note={`${PORTS[type].in.length} in · ${PORTS[type].out.length} out`} />
      <PortTable nodeId={node.id} type={type} />

      <SectionHead label="Settings" />
      <div className="space-y-3.5 p-2.5">
        <Field label="Label">
          <input
            className={inputCls}
            value={d.label ?? ""}
            onChange={(e) => update({ label: e.target.value })}
          />
        </Field>

        {node.type === "agent" && (
          <Field label="Role id">
            <input
              className={inputCls}
              value={d.roleId ?? ""}
              onChange={(e) => update({ roleId: e.target.value })}
              placeholder="PO, BE, QA…"
            />
          </Field>
        )}

        {node.type === "skill" && (
          <Field label="Skill id">
            <input
              className={inputCls}
              value={d.skillId ?? ""}
              onChange={(e) => update({ skillId: e.target.value })}
              placeholder="tdd, hallmark…"
            />
          </Field>
        )}

        {node.type === "gate" && (
          <>
            <Field label="Gate id">
              <input
                className={inputCls}
                value={d.gateId ?? ""}
                onChange={(e) => update({ gateId: e.target.value })}
                placeholder="stl, qa, arch, sec…"
              />
            </Field>
            <AssistedField key={`${node.id}:checklist`} nodeId={node.id} nodeType={type} field="checklist" label="Checklist">
              <textarea
                className={textareaCls}
                value={d.checklist ?? ""}
                onChange={(e) => update({ checklist: e.target.value })}
                placeholder="AC · DoD · points"
              />
            </AssistedField>
          </>
        )}

        {node.type === "hitl" && (
          <Field label="Approval Label">
            <input
              className={inputCls}
              value={d.approvalLabel ?? ""}
              onChange={(e) => update({ approvalLabel: e.target.value })}
            />
          </Field>
        )}

        {node.type === "mcp" && (
          <>
            <Field label="MCP URL">
              <input
                className={inputCls}
                value={d.mcpUrl ?? ""}
                onChange={(e) => update({ mcpUrl: e.target.value })}
                placeholder="http://localhost:3100/mcp"
              />
            </Field>
            <Field label="MCP command">
              <input
                className={inputCls}
                value={d.mcpCommand ?? ""}
                onChange={(e) => update({ mcpCommand: e.target.value })}
                placeholder="npx -y @modelcontextprotocol/server-…"
              />
            </Field>
          </>
        )}

        {node.type === "tool" && (
          <Field label="Tool kind">
            <input
              className={inputCls}
              value={d.toolKind ?? ""}
              onChange={(e) => update({ toolKind: e.target.value })}
              placeholder="shell, http, repo…"
            />
          </Field>
        )}

        {(node.type === "agent" || node.type === "gate" || node.type === "skill") && (
          <Field label="Emits (Signals)">
            <textarea
              className={textareaCls}
              value={(d.emits ?? []).join("\n")}
              onChange={(e) =>
                update({
                  emits: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder={'Ready for QA\nApproved for Architecture Review'}
            />
          </Field>
        )}
      </div>

      {isModel && (
        <>
          <SectionHead label="Provider" note="resolved per node" />

          <div className="space-y-3.5 p-2.5">
            {node.type === "agent" && (
              <Field label="Connection pin">
                <Combobox
                  label="Connection pin"
                  triggerLabel={`Connection pin: ${pinned ? pinned.label : pin ? pin + " (removed)" : "Use chat default (in chat)"}`}
                  describedBy={providerHintId}
                  value={pin ?? ""}
                  options={pinOptions}
                  onChange={(id) =>
                    update({
                      providerIds: id
                        ? [id, ...(d.providerIds ?? []).slice(1).filter((other) => other !== id)]
                        : [],
                    })
                  }
                  triggerClassName={pickerCls}
                  trigger={
                    <>
                      <span className="min-w-0 truncate">
                        {pinned ? pinned.label : pin ? pin : "Use chat default (in chat)"}
                      </span>
                      <span className="t-meta flex-none text-ink-mute">{pinned ? readinessWord(pinned) : pin ? "Removed" : ""}</span>
                    </>
                  }
                />
                <p id={providerHintId} className="t-meta mt-1 leading-4 text-ink-dim">
                  Applies to this agent only. In chat, a pinned connection overrides the chat provider;
                  unpinned agents use the chat default. Connected Studio runs require an explicit pin.
                </p>
              </Field>
            )}

            {node.type === "agent" && (
              <FallbackConnections
                providerIds={d.providerIds ?? []}
                connections={connections}
                onChange={(providerIds) => update({ providerIds })}
              />
            )}

            <Field label="Model">
              <ModelPicker
                connection={pinned ?? null}
                value={d.model ?? ""}
                onChange={(model) => update({ model })}
                label="Model"
                inheritLabel="Connection default"
                inheritDetail={inheritDetail}
                triggerClassName={pickerCls}
              />
            </Field>

            <details className="rounded-control border border-line-soft p-2">
              <summary className="t-meta cursor-pointer text-ink-mute">Legacy bundle settings</summary>
              <p className="t-meta my-2 leading-4 text-ink-mute">Preserved for compatibility. Connected runs use the connection pin; simulation calls no provider.</p>
              <div className="space-y-3.5">
            <Field label="Adapter">
              <select
                className={inputCls}
                value={d.adapter ?? "mock"}
                onChange={(e) => update({ adapter: e.target.value as AdapterType })}
              >
                {ADAPTERS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Field>

            {(d.adapter === "ollama" || d.adapter === "lmstudio") && (
              <Field label="Endpoint">
                <input
                  className={inputCls}
                  value={d.endpoint ?? ""}
                  onChange={(e) => update({ endpoint: e.target.value })}
                  placeholder="http://localhost:11434/v1"
                />
              </Field>
            )}

            {(d.adapter ?? "mock") !== "mock" && (
              <Field label="Credential">
                <select
                  className={inputCls}
                  value={d.secretRef ?? ""}
                  onChange={(e) => {
                    const secretRef = e.target.value || undefined;
                    // Drop any legacy plaintext apiKey when binding a vault ref.
                    update({ secretRef, apiKey: undefined });
                  }}
                >
                  <option value="">{PROVIDERS_BIND_NONE}</option>
                  {sealed.map((c) => (
                    <option key={c.id} value={c.secret!.service}>
                      {c.label} · {c.secret!.prefix}…{c.secret!.tail}
                    </option>
                  ))}
                </select>
                {sealed.length === 0 && (
                  <p className="t-meta mt-1 text-ink-mute">
                    Seal a key under Providers (Alt+4). The inspector only stores the reference.
                  </p>
                )}
              </Field>
            )}

              </div>
            </details>

            <AssistedField key={`${node.id}:systemPrompt`} nodeId={node.id} nodeType={type} field="systemPrompt" label="System Prompt">
              <textarea
                className={textareaCls}
                value={d.systemPrompt ?? ""}
                onChange={(e) => update({ systemPrompt: e.target.value })}
                placeholder="You are a helpful assistant..."
              />
            </AssistedField>

            <Field label={`Temperature — ${d.temperature ?? 0.7}`}>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={d.temperature ?? 0.7}
                onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
                className="w-full"
              />
            </Field>

            <Field label="Max Tokens">
              <input
                className={inputCls}
                type="number"
                value={d.maxTokens ?? 4096}
                onChange={(e) => update({ maxTokens: parseInt(e.target.value, 10) })}
              />
            </Field>

            <Field label="Token Limit (budget)">
              <input
                className={inputCls}
                type="number"
                min={0}
                placeholder="no limit"
                value={d.tokenLimit ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  update({ tokenLimit: raw === "" ? undefined : Math.max(0, parseInt(raw, 10) || 0) });
                }}
              />
            </Field>
            <p className="t-meta -mt-2 text-ink-mute">
              Stops this node honestly (not the whole run) if its own turn spends at or over this
              many tokens. Separate from Max Tokens, which only caps generation length.
            </p>
          </div>
        </>
      )}

      {d.status && d.status !== "idle" && (
        <>
          <SectionHead label="Last run" />
          <div className="space-y-1 p-2.5">
            <div className="t-meta flex justify-between text-ink-mute">
              status <span className="text-signal-text">{d.status}</span>
            </div>
            {d.tokens !== undefined && (
              <div className="t-meta flex justify-between text-ink-mute">
                tokens <span className="text-ink-dim">{d.tokens}</span>
              </div>
            )}
            {d.latencyMs !== undefined && (
              <div className="t-meta flex justify-between text-ink-mute">
                latency <span className="text-ink-dim">{d.latencyMs}ms</span>
              </div>
            )}
            {d.output && (
              <pre className="t-meta oh-inset mt-2 max-h-[160px] overflow-auto whitespace-pre-wrap break-all p-2 text-ink-dim">
                {d.output}
              </pre>
            )}
            {d.error && <div className="t-meta pt-1 text-fault-text">{d.error}</div>}
          </div>
        </>
      )}
    </Panel>
  );
}
