import { specOf, type Connection } from "./providerStore";

/** One account + model combination the chat can run. */
export type ModelChoice = { connectionId: string; model: string };

const key = (c: ModelChoice) => `${c.connectionId}\0${c.model}`;

/** Newest first, no repeats, at most five. */
export function rememberChoice(recent: ModelChoice[], next: ModelChoice): ModelChoice[] {
  if (!next.connectionId || !next.model) return recent;
  return [next, ...recent.filter((item) => key(item) !== key(next))].slice(0, 5);
}

export type CheapestPick = { connection: Connection; model: string; price: [number, number] };

/** The model with the lowest list price (input, then output) among accounts billed per token.
    A subscription is left out: its list price is not what a turn costs. Null unless there are
    at least two priced models to compare, so the row never names a winner of a field of one. */
export function cheapestModel(connections: Connection[]): CheapestPick | null {
  const priced: CheapestPick[] = [];
  for (const c of connections) {
    if (specOf(c)?.credential.kind !== "api-key") continue;
    for (const m of c.models) if (m.price) priced.push({ connection: c, model: m.id, price: m.price });
  }
  if (priced.length < 2) return null;
  return priced.slice().sort((a, b) => a.price[0] - b.price[0] || a.price[1] - b.price[1])[0];
}
