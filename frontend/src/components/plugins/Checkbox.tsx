"use client";
import { useId, type ReactNode } from "react";

/** A labelled checkbox: the whole label is the target, and the box keeps the system's focus ring. */
export function Checkbox({ checked, onChange, children, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; children: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex min-h-control-md items-start gap-2 pointer-coarse:min-h-control-touch">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 flex-none accent-(--signal)" />
      <label htmlFor={id} className="text-body font-medium text-ink">
        {children}
      </label>
    </div>
  );
}
