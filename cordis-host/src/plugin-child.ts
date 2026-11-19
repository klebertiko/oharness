/**
 * Entry of one isolated plugin process.
 *
 * The host starts this file with Node's permission model on (see
 * isolated-plugin.ts for the flags), so the plugin shares this process with
 * nothing of the host's but the pinned modules it may read. This file trusts
 * its parent: it reads NDJSON from stdin and answers on fd 3 (see ipc.ts).
 * The parent does not trust what arrives on fd 3.
 */
// Must stay first: it locks down `process` before anything else, and long before plugin code, runs.
import './child-guard.ts'
import { Socket } from 'node:net'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { HostError } from './errors.ts'
import { CHILD_MESSAGE_LIMIT, type ParentMessage } from './ipc.ts'
import { asPlugin, BASE_SERVICES, hostContext, listServices, loadPlugin } from './plugin-load.ts'
import { confineSnapshot, OutsidePackageError } from './register-alias.ts'

const ERROR_LIMIT = 4000

const channel = new Socket({ fd: 3, readable: false, writable: true })

/** One line to the host. A line the host would refuse is replaced by `fallback`, if any, so the plugin keeps running. */
function send(message: Record<string, unknown>, fallback?: Record<string, unknown>): void {
  let line = JSON.stringify(message)
  if (Buffer.byteLength(line) >= CHILD_MESSAGE_LIMIT) {
    if (fallback === undefined) return
    line = JSON.stringify(fallback)
  }
  channel.write(`${line}
`)
}

function errorText(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback
  return message.slice(0, ERROR_LIMIT)
}

/** JSON round-trip, so a value the IPC channel cannot carry fails here and not in the host. */
function plain(value: unknown): unknown {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value)) as unknown
}

const context = await hostContext()
const aborts = new Map<string, AbortController>()
let loaded = false

async function load(message: Extract<ParentMessage, { type: 'load' }>): Promise<void> {
  if (loaded) return
  loaded = true
  const empty = { unmet: [], tools: [], subsetTools: [], commands: [], projections: [], services: [] }
  confineSnapshot(message.snapshot)
  let plugin: unknown
  try {
    plugin = asPlugin(await import(pathToFileURL(message.entry).href))
  } catch (error) {
    if (error instanceof OutsidePackageError) {
      send({ type: 'loaded', status: 'failed', ...empty, code: 'path-rejected', message: errorText(error, 'path rejected') })
      return
    }
    if (error instanceof HostError && error.code === 'not-a-plugin') {
      send({ type: 'loaded', status: 'failed', ...empty, code: 'not-a-plugin', message: errorText(error, 'not a plugin') })
      return
    }
    send({ type: 'loaded', status: 'failed', ...empty, message: errorText(error, 'plugin failed to load') })
    return
  }
  const outcome = await loadPlugin(context, plugin, message.config)
  const tools = context.tools.names()
  send({
    type: 'loaded',
    status: outcome.status,
    unmet: [...outcome.unmet],
    tools: [...tools],
    subsetTools: tools.filter((name) => context.tools.usesSubset(name)),
    commands: [...context.commands.names()],
    projections: [...context.sessionProjections.keys()],
    services: listServices(context).filter((row) => !BASE_SERVICES.includes(row.name)),
    ...(outcome.message === undefined ? {} : { message: outcome.message.slice(0, ERROR_LIMIT) }),
  })
}

async function answer(id: string, run: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
  const controller = new AbortController()
  aborts.set(id, controller)
  try {
    const value = plain(await run(controller.signal))
    send({ type: 'result', id, ok: true, value }, { type: 'result', id, ok: false, error: 'the result is larger than the limit' })
  } catch (error) {
    send({ type: 'result', id, ok: false, error: errorText(error, 'plugin call failed') })
  } finally {
    aborts.delete(id)
  }
}

function agentFor(id: string): unknown {
  return {
    session: {
      append(event: string, data: unknown) {
        send({ type: 'session-append', id, event, data: plain(data) })
      },
    },
  }
}

function receive(line: string): void {
  const message = JSON.parse(line) as ParentMessage
  switch (message.type) {
    case 'load':
      void load(message)
      return
    case 'invoke':
      void answer(message.id, (signal) => context.tools.invoke(message.name, message.args, {
        callId: message.id,
        signal,
        ...(message.agent ? { agent: agentFor(message.id) } : {}),
      }))
      return
    case 'command':
      void answer(message.id, async (signal) => (await context.commands.execute(message.line, signal)) ?? null)
      return
    case 'ping':
      send({ type: 'pong' })
      return
    case 'abort':
      aborts.get(message.id)?.abort()
      return
    case 'emit': {
      const emit = context.emit as (event: string, payload: unknown) => void
      emit(message.name, message.payload)
      return
    }
    case 'dispose':
      void context.fiber.dispose().catch(() => undefined).finally(() => { process.exit(0) })
      return
  }
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', receive)
// The host holds stdin. When it goes away, so does this process.
process.stdin.on('end', () => { process.exit(0) })
send({ type: 'ready' })
