export type Effort = "low" | "medium" | "high";
export type Intent = "auto" | "best" | "fastest" | "cheapest";

export type ChoiceModel = {
  id: string;
  connectionId: string;
  connectionLabel: string;
  available: boolean;
  reason?: string;
  price?: [number, number];
  efforts?: Effort[];
};

export type ModelChoice = { connectionId: string; model: string; effort: Effort | null };

const INTENTS: Intent[] = ["auto", "best", "fastest", "cheapest"];
export { INTENTS };

export function rememberChoice(recent: ModelChoice[], next: ModelChoice): ModelChoice[] {
  const key = `${next.connectionId}\0${next.model}\0${next.effort ?? ""}`;
  const rest = recent.filter((item) => `${item.connectionId}\0${item.model}\0${item.effort ?? ""}` !== key);
  return [next, ...rest].slice(0, 5);
}

function available(models: ChoiceModel[]): ChoiceModel[] {
  return models.filter((model) => model.available);
}

/** Intent picks among models that can answer. Price is the stand-in for best, fastest and cheapest. */
export function pickByIntent(models: ChoiceModel[], intent: Intent): ChoiceModel | null {
  const ready = available(models);
  if (ready.length === 0) return null;
  if (intent === "auto") return ready[0];
  const priced = ready.filter((model) => model.price);
  const pool = priced.length > 0 ? priced : ready;
  if (intent === "cheapest" || intent === "fastest") {
    return pool.slice().sort((a, b) => (a.price?.[0] ?? Number.POSITIVE_INFINITY) - (b.price?.[0] ?? Number.POSITIVE_INFINITY))[0];
  }
  return pool.slice().sort((a, b) => (b.price?.[1] ?? 0) - (a.price?.[1] ?? 0))[0];
}

export function fallbackLine(from: string, to: string, reason: string): { from: string; to: string; reason: string } {
  return { from, to, reason };
}
