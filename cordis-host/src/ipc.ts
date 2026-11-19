/**
 * Messages between the host and one isolated plugin process.
 *
 * The host writes NDJSON to the plugin process's stdin; the plugin process
 * writes NDJSON to fd 3. There is no Node IPC channel. The plugin process is
 * untrusted: the plugin's own code shares it and can write anything to fd 3. Every message the host receives is
 * parsed with a strict schema; anything else stops that plugin. Payloads
 * (`value`, `data`) stay `unknown` and are only passed on as JSON.
 */
import { z } from 'zod'

/** Argument the host passes to a plugin process granted "processes" (read by child-guard.ts). */
export const PROCESSES_ARG = '--oh-capability-processes'

/** Session events a plugin may append to the caller's session. tool-todo writes its list. */
export const SESSION_EVENTS: readonly string[] = ['todo/write']

/**
 * Longest line, in bytes, the host reads from a plugin process. The host
 * counts bytes before it parses and kills a process that goes over.
 */
export const CHILD_MESSAGE_LIMIT = 1024 * 1024

/** Largest `data` one session-append may carry, as serialized JSON. */
export const SESSION_APPEND_LIMIT = 64 * 1024
/** Most session-append messages one tool call may send. */
export const SESSION_APPENDS_PER_CALL = 100

const id = z.string().regex(/^[0-9a-f-]{36}$/u)
const name = z.string().min(1).max(200)
const names = z.array(name).max(1000)
const text = z.string().max(4000)

const serviceInfo = z.strictObject({
  name,
  implementation: z.string().max(200).optional(),
  chain: z.array(z.string().max(200)).max(8),
})

export const childMessage = z.union([
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('pong') }),
  z.strictObject({
    type: z.literal('loaded'),
    status: z.enum(['active', 'pending', 'failed']),
    unmet: names,
    tools: names,
    subsetTools: names,
    commands: names,
    projections: names,
    services: z.array(serviceInfo).max(200),
    code: z.enum(['path-rejected', 'not-a-plugin']).optional(),
    message: text.optional(),
  }),
  z.strictObject({ type: z.literal('result'), id, ok: z.literal(true), value: z.unknown().optional() }),
  z.strictObject({ type: z.literal('result'), id, ok: z.literal(false), error: text }),
  z.strictObject({ type: z.literal('session-append'), id, event: name, data: z.unknown().optional() }),
])

export type ChildMessage = z.infer<typeof childMessage>
export type ServiceRow = z.infer<typeof serviceInfo>

/** Messages the host sends. The child trusts its parent, so these are typed, not re-validated. */
export type ParentMessage =
  | { readonly type: 'load'; readonly entry: string; readonly snapshot: string; readonly config?: unknown }
  | { readonly type: 'invoke'; readonly id: string; readonly name: string; readonly args: unknown; readonly agent: boolean }
  | { readonly type: 'command'; readonly id: string; readonly line: string }
  | { readonly type: 'abort'; readonly id: string }
  | { readonly type: 'emit'; readonly name: string; readonly payload: unknown }
  | { readonly type: 'ping' }
  | { readonly type: 'dispose' }

/** Parse one line from a plugin process. Returns undefined when it is not a valid message. */
export function parseChildLine(line: string): ChildMessage | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return undefined
  }
  const parsed = childMessage.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}
