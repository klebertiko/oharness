/** Drag the preferred account to the front. The engine walks this order. */
export function movePreference(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = ids.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function renameAccount(labels: Record<string, string>, id: string, label: string): Record<string, string> {
  const trimmed = label.trim();
  if (!trimmed) return labels;
  return { ...labels, [id]: trimmed };
}
