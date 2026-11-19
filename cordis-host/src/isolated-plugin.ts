/**
 * One plugin in its own Node process, under Node's permission model.
 *
 * Without a capability the plugin process can read only its snapshot and
 * this host's pinned modules (`src/`, `vendor/`, `node_modules/`), cannot
 * write anywhere, cannot start a process, worker, addon or WASI instance, and
 * gets no environment variables from the host. Network is not gated: Node
 * 22 and 24 have no network permission (see ADR 0071, item 10).
 */
import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PROCESSES_ARG } from './child-guard.ts'
import { parseChildMessage, type ChildMessage, type ParentMessage, type ServiceRow } from './ipc.ts'
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

export const DEFAULT_CALL_TIMEOUT_MS = 30_000
const LOAD_TIMEOUT_MS = 30_000
const STOP_GRACE_MS = 2_000

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
 * the host's variables (only `SystemRoot` on Windows, which Windows needs to
 * start Node). `NODE_OPTIONS` never passes: it could add permission flags.
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
}

export interface IsolatedStart {
  readonly entry: string
  readonly snapshot: string
  readonly capabilities: readonly Capability[]
  readonly config?: unknown
  readonly callTimeoutMs?: number
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

  private constructor(start: IsolatedStart) {
    this.#callTimeoutMs = start.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.#child = fork(childEntry, start.capabilities.includes('processes') ? [PROCESSES_ARG] : [], {
      // Not the snapshot: a working directory there keeps Windows from deleting it.
      cwd: here,
      env: childEnv(start.capabilities),
      execArgv: [
        ...permissionFlags(start.snapshot, start.capabilities),
        '--experimental-transform-types',
        '--disable-warning=ExperimentalWarning',
        '--import',
        registerAlias,
      ],
      // The host's stdout carries its banner to the parent, so plugin output goes to stderr.
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
    })
    this.pid = this.#child.pid
    this.#child.stdout?.pipe(process.stderr, { end: false })
    this.#child.stderr?.pipe(process.stderr, { end: false })
    this.#exited = new Promise((resolve) => {
      this.#child.once('exit', () => {
        this.#fail('the plugin process exited')
        resolve()
      })
    })
    this.#child.once('error', () => { this.#fail('the plugin process failed to start') })
    this.#child.on('message', (raw: unknown) => { this.#receive(raw, start) })
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
    if (this.#child.connected) this.#child.send(message)
  }

  #receive(raw: unknown, start: IsolatedStart): void {
    const message = parseChildMessage(raw)
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
    const pending = this.#pending.get(message.id)
    if (pending === undefined) return
    if (message.type === 'session-append') {
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

  #fail(reason: string): void {
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
      }, this.#callTimeoutMs)
      this.#pending.set(id, { resolve, reject, timer, agent })
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
