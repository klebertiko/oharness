"use client";
import { NiloSprite } from "@/components/brand/NiloSprite";
import { Button } from "@/components/ui";
import { tr } from "@/i18n/store";

export type TaskCardModel = {
  id: string;
  title: string;
  state: "running" | "interrupted" | "done" | "failed" | "cancelled";
  elapsed: string;
  milestones: string[];
  summary?: string;
};

const STATE_KEY = {
  running: "nilo.tasks.working",
  interrupted: "nilo.tasks.interrupted",
  done: "nilo.tasks.done",
  failed: "nilo.tasks.failed",
  cancelled: "nilo.tasks.cancel",
} as const;

/** A status card. The handoff is the card, not a sentence. */
export function TaskCard({
  task,
  onCancel,
  onContinue,
}: {
  task: TaskCardModel;
  onCancel: (id: string) => void;
  onContinue: (id: string) => void;
}) {
  const pose = task.state === "running" ? "working" : task.state === "failed" ? "error" : task.state === "done" ? "success" : "waiting";
  return (
    <article className="flex flex-col gap-2 rounded-panel border border-line-soft bg-sub-100 p-3" aria-label={task.title}>
      <div className="flex items-center gap-2">
        <NiloSprite state={pose} cell={3} label={tr(STATE_KEY[task.state])} />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-title text-ink">{task.title}</h3>
          <p className="m-0 text-meta text-ink-dim">
            <time>{task.elapsed}</time>
            {" · "}
            {tr(STATE_KEY[task.state])}
          </p>
        </div>
        {task.state === "running" ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onCancel(task.id)}>
            {tr("nilo.tasks.cancel")}
          </Button>
        ) : null}
        {task.state === "interrupted" ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => onContinue(task.id)}>
            {tr("nilo.tasks.continue")}
          </Button>
        ) : null}
      </div>
      {task.milestones.length > 0 ? (
        <ul className="m-0 list-none p-0 text-meta text-ink-dim">
          {task.milestones.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {task.summary ? <p className="m-0 text-body text-ink">{task.summary}</p> : null}
    </article>
  );
}

/** Off until the person turns it on. */
export function NotificationSwitch({ enabled, onChange }: { enabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-body text-ink">
      <input
        type="checkbox"
        role="switch"
        checked={enabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={tr("nilo.tasks.notifications")}
      />
      <span>
        {tr("nilo.tasks.notifications")}
        <span className="block text-meta text-ink-dim">{tr("nilo.tasks.notificationsHint")}</span>
      </span>
    </label>
  );
}
