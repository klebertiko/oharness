"use client";
import { useEffect, useState } from "react";
import { Button, Input, Panel } from "@/components/ui";
import { tr } from "@/i18n/store";
import type { MessageKey } from "@/i18n/messages.en";
import type { MemoryKind } from "../api";
import { useMemoryStore } from "../store";

const KINDS: MemoryKind[] = ["rule", "profile", "fact"];
const KIND_KEY: Record<MemoryKind, MessageKey> = {
  rule: "nilo.memory.kind.rule",
  profile: "nilo.memory.kind.profile",
  fact: "nilo.memory.kind.fact",
};
const ERRORS = new Set<string>([
  "nilo.memory.error.fixedName",
  "nilo.memory.error.tooLong",
  "nilo.memory.error.tooMany",
  "nilo.memory.error.empty",
  "nilo.memory.error.confirm",
  "nilo.memory.error.notFound",
]);

/** What Nilo remembers. The person writes, edits, pins and forgets. The name stays Nilo. */
export function MemoryScreen() {
  const { items, error, load, add, save, pin, forget, forgetAll } = useMemoryStore();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<MemoryKind>("rule");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel title={tr("nilo.memory.title")}>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add(kind, text).then(() => setText(""));
        }}
      >
        <label className="text-body text-ink" htmlFor="nilo-memory-kind">
          {tr("nilo.memory.kindLabel")}
        </label>
        <select id="nilo-memory-kind" className="h-control-md rounded-control border border-line-strong bg-sub-000 px-2 text-title" value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)}>
          {KINDS.map((item) => (
            <option key={item} value={item}>
              {tr(KIND_KEY[item])}
            </option>
          ))}
        </select>
        <Input label={tr("nilo.memory.text")} value={text} onChange={(event) => setText(event.target.value)} />
        <Button type="submit" variant="primary" size="sm">
          {tr("nilo.memory.add")}
        </Button>
      </form>
      {error ? <p className="text-body text-fault-text">{tr((ERRORS.has(error) ? error : "nilo.memory.error.notFound") as MessageKey)}</p> : null}
      {items.length === 0 ? <p className="text-body text-ink-dim">{tr("nilo.memory.empty")}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 rounded-control border border-line-soft p-2">
            <span className="text-meta text-ink-dim">{tr(KIND_KEY[item.kind])} · {item.status === "proposed" ? tr("nilo.memory.proposed") : tr("nilo.memory.scope.global")}</span>
            <Input
              label={tr("nilo.memory.text")}
              value={drafts[item.id] ?? item.text}
              onChange={(event) => setDrafts({ ...drafts, [item.id]: event.target.value })}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => void save(item.id, drafts[item.id] ?? item.text)}>
                {tr("nilo.memory.save")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void pin(item.id, !item.pinned)}>
                {item.pinned ? tr("nilo.memory.unpin") : tr("nilo.memory.pin")}
              </Button>
              <Button type="button" size="sm" variant="danger" onClick={() => void forget(item.id)}>
                {tr("nilo.memory.forget")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Input label={tr("nilo.memory.confirm")} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      <Button type="button" size="sm" variant="danger" onClick={() => void forgetAll(confirm)}>
        {tr("nilo.memory.forgetAll")}
      </Button>
    </Panel>
  );
}
