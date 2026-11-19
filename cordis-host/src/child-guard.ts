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
 *
 * Both are replaced, before any plugin code runs, by non-writable,
 * non-configurable guards, so the plugin cannot restore them. A plugin may
 * signal itself; with the "processes" capability it may signal other
 * processes, but never the host. The host also runs with `--disable-sigusr1`,
 * which covers a process the plugin starts (see ADR 0071, item 10).
 *
 * `process`, `globalThis.process`, `import process from 'node:process'` and
 * `process.getBuiltinModule('node:process')` are the same object.
 */

import { PROCESSES_ARG } from './ipc.ts'

const host = process.ppid
const processes = process.argv.includes(PROCESSES_ARG)

function denied(what: string): Error {
  return Object.assign(new Error(`${what} is not allowed in an isolated plugin`), { code: 'ERR_ACCESS_DENIED' })
}

function checkTarget(pid: unknown, what: string): void {
  const target = Number(pid)
  if (target === process.pid) return
  if (processes && Number.isInteger(target) && target > 0 && target !== host) return
  throw denied(what)
}

function lock(name: string, value: unknown): void {
  Object.defineProperty(process, name, { value, writable: false, configurable: false, enumerable: true })
}

type Kill = (pid: number, signal?: string | number) => unknown
const kill = process.kill.bind(process) as Kill
const rawKill = (process as unknown as { _kill: Kill })._kill.bind(process)

lock('_debugProcess', () => { throw denied('process._debugProcess') })
lock('_kill', (pid: number, signal: number) => {
  checkTarget(pid, 'process._kill')
  return rawKill(pid, signal)
})
lock('kill', (pid: number, signal?: string | number) => {
  checkTarget(pid, 'process.kill')
  return kill(pid, signal)
})
