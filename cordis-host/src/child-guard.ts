/**
 * First module of an isolated plugin process: closes the ways a plugin
 * reaches its host through `process` itself, which Node's permission model
 * does not gate.
 *
 * - `process._debugProcess(pid)` opens the inspector of another Node process
 *   (SIGUSR1 on POSIX, a remote thread on Windows). Aimed at the host, the
 *   plugin then drives the host over the inspector port.
 * - `process.kill(pid, signal)` and the raw `process._kill` can send SIGUSR1
 *   (same result) or kill the host.
 * - `os.setPriority(pid, priority)` can slow the host down.
 *
 * All are replaced, before any plugin code runs, by non-writable,
 * non-configurable guards, so the plugin cannot restore them. A pid passes
 * only as a primitive integer in the positive int32 range, because Node
 * truncates to int32 (2^32 would become 0, the process group, and host + 2^32
 * the host). A plugin may signal itself; with the "processes" capability it
 * may signal any other such pid, but never the host. It may change only its
 * own priority, with or without "processes". The host also runs with
 * `--disable-sigusr1`, which covers a process the plugin starts (see ADR
 * 0071, item 10).
 *
 * `process`, `globalThis.process`, `import process from 'node:process'` and
 * `process.getBuiltinModule('node:process')` are the same object.
 */

import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import { PROCESSES_ARG } from './ipc.ts'

const host = process.ppid
const processes = process.argv.includes(PROCESSES_ARG)

function denied(what: string): Error {
  return Object.assign(new Error(`${what} is not allowed in an isolated plugin`), { code: 'ERR_ACCESS_DENIED' })
}

/**
 * The pid that may be signalled, as a plain number. Only a primitive integer
 * passes: an object would be converted again by Node after this check, and
 * its valueOf could answer another pid the second time. The returned number,
 * not the argument, is what reaches Node.
 */
function checkTarget(pid: unknown, what: string): number {
  if (!isPid(pid)) throw denied(what)
  if (pid === process.pid) return pid
  if (processes && pid !== host) return pid
  throw denied(what)
}

/** A primitive integer in the positive int32 range, the only pids Node does not truncate. */
function isPid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 && pid <= 0x7fffffff && (pid | 0) === pid
}

/** A signal as Node accepts it, primitive only, for the same reason. */
function checkSignal(signal: unknown, what: string, optional: boolean): string | number | undefined {
  if (optional && signal === undefined) return undefined
  if (typeof signal === 'string' || (typeof signal === 'number' && Number.isInteger(signal))) return signal
  throw denied(what)
}

function lock(name: string, value: unknown): void {
  Object.defineProperty(process, name, { value, writable: false, configurable: false, enumerable: true })
}

type Kill = (pid: number, signal?: string | number) => unknown
const kill = process.kill.bind(process) as Kill
const rawKill = (process as unknown as { _kill: Kill })._kill.bind(process)

type SetPriority = (pid: number, priority: number) => void
const setPriority = os.setPriority.bind(os) as SetPriority

/** `os.setPriority([pid,] priority)`: only this process, pid 0 or its own pid. */
function guardedSetPriority(pidOrPriority: unknown, maybePriority?: unknown): void {
  const what = 'os.setPriority'
  const self = maybePriority === undefined
  const priority = self ? pidOrPriority : maybePriority
  if (typeof priority !== 'number' || !Number.isInteger(priority)) throw denied(what)
  if (!self && pidOrPriority !== 0 && pidOrPriority !== process.pid) throw denied(what)
  setPriority(0, priority)
}
Object.defineProperty(os, 'setPriority', { value: guardedSetPriority, writable: false, configurable: false, enumerable: true })
// `import { setPriority } from 'node:os'` reads a copy of the export; refresh it.
syncBuiltinESMExports()

lock('_debugProcess', () => { throw denied('process._debugProcess') })
lock('_kill', (pid: unknown, signal: unknown) => {
  const target = checkTarget(pid, 'process._kill')
  const checked = checkSignal(signal, 'process._kill', false)
  if (typeof checked !== 'number') throw denied('process._kill')
  return rawKill(target, checked)
})
lock('kill', (pid: unknown, signal?: unknown) => {
  const target = checkTarget(pid, 'process.kill')
  return kill(target, checkSignal(signal, 'process.kill', true))
})
