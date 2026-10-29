"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  const [editing, setEditing] = useState<string | null>(null);
  const uid = useId();
  const programRef = useRef<HTMLInputElement>(null);

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
      setEditing(null);
      setError("");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (id: string) => {
    try {
      await toolHooksApi.remove(id);
      if (editing === id) stopEditing();
      load();
    } catch {
      setError("Could not remove the hook.");
    }
  };
  const stopEditing = () => {
    setDraft(EMPTY);
    setEditing(null);
    setError("");
  };
  const edit = (row: ToolHookRow) => {
    const [program = "", ...args] = row.argv;
    setDraft({ id: row.id, program, args: args.join("\n"), timeoutS: String(row.timeout_s), tools: [...row.tools] });
    setEditing(row.id);
    setError("");
    // The form is below the list: bring the keyboard and the screen reader to it.
    setTimeout(() => programRef.current?.focus(), 0);
  };
  const toggleTool = (tool: string) =>
    setDraft((d) => ({ ...d, tools: d.tools.includes(tool) ? d.tools.filter((t) => t !== tool) : [...d.tools, tool] }));
  const field = "h-control-md min-w-0 rounded-control border border-line-strong bg-sub-100 px-2 text-body text-ink";

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Tool hooks</Button>
      <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (!next) stopEditing(); }} title="Tool hooks" showClose className="w-[min(560px,calc(100vw-24px))]">
        <div className="flex flex-col gap-3 overflow-y-auto p-3">
          <p className="text-body text-ink-mute">
            A hook runs before a tool. It must exit 0 for the tool to run; an error or a timeout blocks it. Hooks run without a shell and without your secrets.
          </p>
          <ul aria-label="Registered hooks" className="flex flex-col gap-1">
            {rows?.length === 0 && <li className="text-body text-ink-mute">No hooks yet.</li>}
            {rows?.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-body text-ink-dim">
                <span className="min-w-0 flex-1 truncate">
                  <strong className="text-ink">{row.id}</strong> · {row.tools.join(", ")} · {row.timeout_s}s{row.invalid ? " · blocks every tool until you remove it and register it again" : ""}
                </span>
                {!row.invalid && <Button size="sm" onClick={() => edit(row)} aria-label={`Edit hook ${row.id}`}>Edit</Button>}
                <Button size="sm" onClick={() => remove(row.id)} aria-label={`Remove hook ${row.id}`}>Remove</Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            {editing && <p role="status" className="text-body text-ink-mute">{`Editing ${editing}. Saving replaces it.`}</p>}
            <label htmlFor={`${uid}-id`} className="text-body text-ink-dim">Hook id</label>
            <input id={`${uid}-id`} className={field} value={draft.id} readOnly={Boolean(editing)} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
            <label htmlFor={`${uid}-prog`} className="text-body text-ink-dim">Program (full path)</label>
            <input id={`${uid}-prog`} ref={programRef} className={field} value={draft.program} onChange={(e) => setDraft({ ...draft, program: e.target.value })} />
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
            <div className="flex gap-2">
              <Button variant="primary" onClick={save}>Save hook</Button>
              {editing && <Button onClick={stopEditing}>Cancel edit</Button>}
            </div>
          </div>
        </div>
      </Sheet>
    </>
  );
}
