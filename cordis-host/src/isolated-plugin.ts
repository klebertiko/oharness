/**
 * One plugin in its own Node process, under Node's permission model.
 *
 * Without a capability the plugin process can read only its snapshot and
 * this host's pinned modules (`src/`, `vendor/`, `node_modules/`), cannot
 * write anywhere, cannot start a process, worker, addon or WASI instance, and
 * gets none of the host's own environment variables. Network is not gated:
 * Node 22 and 24 have no network permission, so the plugin reaches loopback
 * services, this host included (see ADR 0071, item 10).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CHILD_MESSAGE_LIMIT, parseChildLine, PROCESSES_ARG, SESSION_APPEND_LIMIT, SESSION_APPENDS_PER_CALL, SESSION_EVENTS, type ChildMessage, type ParentMessage, type ServiceRow } from './ipc.ts'
import { LineSplitter, outputLine } from './lines.ts'
import type { Capability } from './manifest.ts'
import { isRecord } from './plugin-load.ts'

const here = realpathSync(fileURLToPath(new URL('.', import.meta.url)))
const hostDir = path.dirname(here)
const childEntry = path.join(here, 'plugin-child.ts')
const registerAlias = pathToFileURL(path.join(here, 'register-alias.ts')).href

/** Host files an isolated plugin may read: pinned code only, not test/ or proofs/. */
export const HOST_READ_PATHS: readonly string[] = [
  here,
  path.join(hostDir, 'vendor'),
  path.join(hostDir, 'node_modules'),
  path.join(hostDir, 'package.json'),
]

/** V8 old-space limit of one plugin process, in MiB. */
export const PLUGIN_HEAP_MB = 512
export const DEFAULT_CALL_TIMEOUT_MS = 30_000
const LOAD_TIMEOUT_MS = 30_000
/** How long a plugin process has to exit after dispose, or to answer a ping after a call timed out. */
const STOP_GRACE_MS = 2_000
/** Longest line of plugin output passed on; a longer one is cut. */
const OUTPUT_LINE_LIMIT = 8 * 1024

/** Node flags for one plugin process. A capability adds its grant; nothing else is ever granted. */
export function permissionFlags(snapshot: string, capabilities: readonly Capability[]): string[] {
  const files = capabilities.includes('files')
  const reads = files ? ['*'] : [snapshot, ...HOST_READ_PATHS]
  const flags = ['--permission', ...reads.map((target) => `--allow-fs-read=${target}`)]
  if (files) flags.push('--allow-fs-write=*')
  if (capabilities.includes('processes')) flags.push('--allow-child-process')
  return flags
}

/**
 * Environment of one plugin process. Without "credentials" it gets none of
 * the host's own variables: on POSIX the environment is empty, and on Windows
 * the host passes only `SystemRoot`, which Node needs to start. libuv then
 * fills in Windows' per-user defaults (HOMEPATH, USERNAME, USERPROFILE, TEMP,
 * PATH and others), so the child is not empty there, but no variable the
 * host set reaches it. `NODE_OPTIONS` never passes: it could add permission
 * flags.
 */
export function childEnv(capabilities: readonly Capability[], env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (capabilities.includes('credentials')) {
    const copy = { ...env }
    for (const key of Object.keys(copy)) if (key.toUpperCase() === 'NODE_OPTIONS') delete copy[key]
    return copy
  }
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT
  return process.platform === 'win32' && systemRoot !== undefined ? { SystemRoot: systemRoot } : {}
}

interface PendingCall {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
  readonly agent: unknown
  appends: number
}

export interface IsolatedStart {
  /** Package name, used to prefix the plugin's output. */
  readonly name: string
  readonly entry: string
  readonly snapshot: string
  readonly capabilities: readonly Capability[]
  readonly config?: unknown
  readonly callTimeoutMs?: number
  /** Where each line of plugin output goes. Defaults to the host's stderr. */
  readonly output?: (line: string) => void
}

function toStderr(line: string): void {
  process.stderr.write(`${line}
`)
}

export class IsolatedPlugin {
  status: 'starting' | 'active' | 'pending' | 'failed' | 'stopped' = 'starting'
  message: string | undefined
  code: 'path-rejected' | 'not-a-plugin' | undefined
  unmet: readonly string[] = []
  tools: readonly string[] = []
  subsetTools: readonly string[] = []
  commands: readonly string[] = []
  projections: readonly string[] = []
  services: readonly ServiceRow[] = []
  readonly pid: number | undefined
  readonly #child: ChildProcess
  readonly #pending = new Map<string, PendingCall>()
  readonly #callTimeoutMs: number
  readonly #exited: Promise<void>
  #onLoaded: ((loaded: boolean) => void) | undefined
  #pingTimer: NodeJS.Timeout | undefined

  private constructor(start: IsolatedStart) {
    this.#callTimeoutMs = start.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    // No Node IPC channel: Node parses each IPC message whole before anyone
    // can measure it. The plugin process writes NDJSON on fd 3 instead, and
    // the host counts bytes before it parses a line (see ipc.ts).
    this.#child = spawn(process.execPath, [
      ...permissionFlags(start.snapshot, start.capabilities),
      `--max-old-space-size=${String(PLUGIN_HEAP_MB)}`,
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--import',
      registerAlias,
      childEntry,
      ...(start.capabilities.includes('processes') ? [PROCESSES_ARG] : []),
    ], {
      // Not the snapshot: a working directory there keeps Windows from deleting it.
      cwd: here,
      env: childEnv(start.capabilities),
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.pid = this.#child.pid
    // The host's stdout carries its banner to the parent, so plugin output goes
    // to stderr: line by line, prefixed, without terminal control sequences.
    const output = start.output ?? toStderr
    for (const stream of [this.#child.stdout, this.#child.stderr]) {
      const lines = new LineSplitter(OUTPUT_LINE_LIMIT, (line) => {
        const text = outputLine(line)
        if (text !== '') output(`[plugin ${outputLine(start.name)}] ${text}`)
      }, 'cut')
      stream?.on('data', (chunk: Buffer) => { lines.push(chunk) })
    }
    const channel = this.#child.stdio[3]
    const messages = new LineSplitter(CHILD_MESSAGE_LIMIT, (line) => { this.#receive(line, start) }, () => {
      this.#fail('the plugin process sent a message over the size limit')
    })
    channel?.on('data', (chunk: Buffer) => { messages.push(chunk) })
    channel?.on('error', () => undefined)
    this.#child.stdin?.on('error', () => undefined)
    this.#exited = new Promise((resolve) => {
      this.#child.once('exit', () => {
        this.#fail('the plugin process exited')
        resolve()
      })
    })
    this.#child.once('error', () => { this.#fail('the plugin process failed to start') })
  }

  /** Start the process, load the plugin in it, and resolve once it reports its state. */
  static async start(start: IsolatedStart): Promise<IsolatedPlugin> {
    const plugin = new IsolatedPlugin(start)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        plugin.#fail('the plugin did not finish loading in time')
        resolve()
      }, LOAD_TIMEOUT_MS)
      plugin.#onLoaded = () => {
        clearTimeout(timer)
        resolve()
      }
    })
    return plugin
  }

  get running(): boolean {
    return this.status === 'active' || this.status === 'pending'
  }

  #send(message: ParentMessage): void {
    const stdin = this.#child.stdin
    if (stdin !== null && stdin.writable) stdin.write(`${JSON.stringify(message)}
`)
  }

  #receive(line: string, start: IsolatedStart): void {
    if (this.status === 'failed' || this.status === 'stopped') return
    const message = parseChildLine(line)
    if (message === undefined) {
      this.#fail('the plugin process sent a malformed message')
      return
    }
    this.#handle(message, start)
  }

  #handle(message: ChildMessage, start: IsolatedStart): void {
    if (message.type === 'ready') {
      if (this.status !== 'starting') return this.#fail('the plugin process sent an unexpected message')
      this.#send({ type: 'load', entry: start.entry, snapshot: start.snapshot, ...(start.config === undefined ? {} : { config: start.config }) })
      return
    }
    if (message.type === 'loaded') {
      if (this.status !== 'starting') return this.#fail('the plugin process sent an unexpected message')
      this.status = message.status
      this.message = message.message
      this.code = message.code
      this.unmet = message.unmet
      this.tools = message.tools
      this.subsetTools = message.subsetTools
      this.commands = message.commands
      this.projections = message.projections
      this.services = message.services
      if (message.status === 'failed') this.#kill()
      this.#onLoaded?.(true)
      return
    }
    if (message.type === 'pong') {
      clearTimeout(this.#pingTimer)
      this.#pingTimer = undefined
      return
    }
    const pending = this.#pending.get(message.id)
    if (pending === undefined) return
    if (message.type === 'session-append') {
      const refused = this.#refuseAppend(pending, message.event, message.data)
      if (refused !== undefined) {
        this.#pending.delete(message.id)
        clearTimeout(pending.timer)
        pending.reject(new Error(refused))
        return
      }
      const agent = pending.agent
      const session = isRecord(agent) ? agent.session : undefined
      if (isRecord(session) && typeof session.append === 'function') {
        try { (session.append as (event: string, data: unknown) => void)(message.event, message.data) } catch { /* the caller's sink */ }
      }
      return
    }
    this.#pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.ok) pending.resolve(message.value)
    else pending.reject(new Error(message.error))
  }

  /** Why one session-append is refused, or undefined when it may pass to the caller's session. */
  #refuseAppend(pending: PendingCall, event: string, data: unknown): string | undefined {
    if (!SESSION_EVENTS.includes(event)) return `session event "${event}" is not allowed`
    if ((JSON.stringify(data) ?? '').length > SESSION_APPEND_LIMIT) return 'session event data is too large'
    pending.appends += 1
    if (pending.appends > SESSION_APPENDS_PER_CALL) return 'too many session events in one call'
    return undefined
  }

  /** After a call timed out: a process that does not answer a ping in time is stuck, so kill it. */
  #ping(): void {
    if (this.#pingTimer !== undefined || !this.running) return
    this.#pingTimer = setTimeout(() => {
      this.#pingTimer = undefined
      this.#fail('the plugin process stopped responding')
    }, STOP_GRACE_MS)
    this.#send({ type: 'ping' })
  }

  #fail(reason: string): void {
    clearTimeout(this.#pingTimer)
    this.#pingTimer = undefined
    if (this.status !== 'stopped' && this.status !== 'failed') {
      this.status = 'failed'
      this.message = reason
    }
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
      this.#pending.delete(id)
    }
    this.#kill()
    this.#onLoaded?.(false)
  }

  #kill(): void {
    if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill('SIGKILL')
  }

  #call(message: (id: string) => ParentMessage, agent: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.running) return Promise.reject(new Error(this.message ?? 'the plugin is not running'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        this.#send({ type: 'abort', id })
        reject(new Error('the plugin call timed out'))
        this.#ping()
      }, this.#callTimeoutMs)
      this.#pending.set(id, { resolve, reject, timer, agent, appends: 0 })
      signal?.addEventListener('abort', () => { this.#send({ type: 'abort', id }) }, { once: true })
      this.#send(message(id))
    })
  }

  invoke(name: string, args: unknown, agent: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.#call((id) => ({ type: 'invoke', id, name, args: args ?? null, agent: agent !== undefined }), agent, signal)
  }

  command(line: string, signal?: AbortSignal): Promise<unknown> {
    return this.#call((id) => ({ type: 'command', id, line }), undefined, signal)
  }

  emit(name: string, payload: unknown): void {
    if (this.running) this.#send({ type: 'emit', name, payload: payload ?? null })
  }

  /** Ask the plugin to dispose, then kill the process if it does not exit in time. */
  async stop(): Promise<void> {
    const wasRunning = this.running
    this.status = 'stopped'
    if (wasRunning) this.#send({ type: 'dispose' })
    const grace = new Promise<void>((resolve) => { setTimeout(resolve, wasRunning ? STOP_GRACE_MS : 0).unref() })
    await Promise.race([this.#exited, grace])
    this.#kill()
    await this.#exited
  }

  /** Kill now, without waiting. For a host that is exiting. */
  killNow(): void {
    this.status = 'stopped'
    this.#kill()
  }
}
