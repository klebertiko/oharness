"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { Button, Sheet } from "@/components/ui";
import { checkHook, HOOK_RULES, type HookDraft } from "@/lib/toolHookRules";
import { toolHooksApi, type ToolHookRow } from "@/lib/toolHooksApi";

const EMPTY: HookDraft = { id: "", program: "", args: "", timeoutS: String(HOOK_RULES.timeoutS.default), tools: ["exec"] };

/** Pre-tool hooks: a program that must exit 0 before a tool runs. Anything else blocks the tool. */
export function ToolHooksButton() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ToolHookRow[] | null>(null);
  const [draft, setDraft] = useState<HookDraft>(EMPTY);
  const [error, setError] = useState("");
  const uid = useId();

  const load = useCallback(() => {
    setError("");
    toolHooksApi.list().then(setRows).catch(() => setError("Hooks are unavailable right now."));
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const save = async () => {
    const check = checkHook(draft);
    if (!check.ok) return setError(check.message);
    try {
      await toolHooksApi.put(check.id, check.body);
      setDraft(EMPTY);
      setError("");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (id: string) => {
    try {
      await toolHooksApi.remove(id);
      load();
    } catch {
      setError("Could not remove the hook.");
    }
  };
  const toggleTool = (tool: string) =>
    setDraft((d) => ({ ...d, tools: d.tools.includes(tool) ? d.tools.filter((t) => t !== tool) : [...d.tools, tool] }));
  const field = "h-control-md min-w-0 rounded-control border border-line-strong bg-sub-100 px-2 text-body text-ink";

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Tool hooks</Button>
      <Sheet open={open} onOpenChange={setOpen} title="Tool hooks" showClose className="w-[min(560px,calc(100vw-24px))]">
        <div className="flex flex-col gap-3 overflow-y-auto p-3">
          <p className="text-body text-ink-mute">
            A hook runs before a tool. It must exit 0 for the tool to run; an error or a timeout blocks it. Hooks run without a shell and without your secrets.
          </p>
          <ul aria-label="Registered hooks" className="flex flex-col gap-1">
            {rows?.length === 0 && <li className="text-body text-ink-mute">No hooks yet.</li>}
            {rows?.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-body text-ink-dim">
                <span className="min-w-0 flex-1 truncate">
                  <strong className="text-ink">{row.id}</strong> · {row.tools.join(", ")} · {row.timeout_s}s{row.invalid ? " · blocks every tool until replaced" : ""}
                </span>
                <Button size="sm" onClick={() => remove(row.id)} aria-label={`Remove hook ${row.id}`}>Remove</Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${uid}-id`} className="text-body text-ink-dim">Hook id</label>
            <input id={`${uid}-id`} className={field} value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
            <label htmlFor={`${uid}-prog`} className="text-body text-ink-dim">Program (full path)</label>
            <input id={`${uid}-prog`} className={field} value={draft.program} onChange={(e) => setDraft({ ...draft, program: e.target.value })} />
            <label htmlFor={`${uid}-args`} className="text-body text-ink-dim">Arguments (one per line)</label>
            <textarea id={`${uid}-args`} rows={2} className={`${field} h-auto py-1`} value={draft.args} onChange={(e) => setDraft({ ...draft, args: e.target.value })} />
            <label htmlFor={`${uid}-to`} className="text-body text-ink-dim">Timeout (seconds)</label>
            <input id={`${uid}-to`} inputMode="numeric" className={field} value={draft.timeoutS} onChange={(e) => setDraft({ ...draft, timeoutS: e.target.value })} />
            <fieldset className="flex flex-wrap gap-3">
              <legend className="text-body text-ink-dim">Runs before</legend>
              {HOOK_RULES.tools.map((tool) => (
                <label key={tool} className="flex items-center gap-1 text-body text-ink-dim">
                  <input type="checkbox" checked={draft.tools.includes(tool)} onChange={() => toggleTool(tool)} /> {tool}
                </label>
              ))}
            </fieldset>
            {error && <p role="alert" className="text-body text-fault-text">{error}</p>}
            <div><Button variant="primary" onClick={save}>Save hook</Button></div>
          </div>
        </div>
      </Sheet>
    </>
  );
}
