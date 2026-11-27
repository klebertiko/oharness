import assert from 'node:assert/strict'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { RunningHost } from '../src/server.ts'
import { SHUTDOWN_TIMEOUT_MS } from '../src/shutdown.ts'
import { HOST_ARGS, IN_PROCESS, asRecord, call, installConfirmed, packageRoot } from './client.ts'

async function startedHost(env: Record<string, string> = {}): Promise<{ child: ChildProcessByStdio<Writable, Readable, null>; banner: Record<string, unknown> }> {
  const child = spawn(process.execPath, [...HOST_ARGS], { cwd: packageRoot, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } })
  let buffered = ''
  const banner = await new Promise<Record<string, unknown>>((resolve, reject) => {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffered += chunk
      const newline = buffered.indexOf('\n')
      if (newline >= 0) resolve(JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>)
    })
    child.once('exit', () => { reject(new Error('host exited before it was ready')) })
  })
  return { child, banner }
}

/** Any process, a plugin's child included, may try to open the host's inspector. The start line refuses it. */
test('the host started by npm start does not open its inspector on request', async () => {
  const { child } = await startedHost()
  try {
    assert.ok(child.pid !== undefined)
    try { (process as unknown as { _debugProcess: (pid: number) => void })._debugProcess(child.pid) } catch { /* refused on Windows; POSIX only sends SIGUSR1 */ }
    if (process.platform !== 'win32') process.kill(child.pid, 'SIGUSR1')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const reached = await fetch('http://127.0.0.1:9229/json/list').then(() => true, () => false)
    assert.equal(reached, false)
    assert.equal(child.exitCode, null, 'the host must survive SIGUSR1')
  } finally {
    child.kill()
  }
})

/** The parent holds the host's stdin. When the parent dies the pipe closes, and the host must stop listening. */
test('host exits when the parent closes its stdin', async () => {
  const child = spawn(
    process.execPath,
    [...HOST_ARGS],
    { cwd: packageRoot, stdio: ['pipe', 'pipe', 'inherit'] },
  )
  try {
    let buffered = ''
    const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffered += chunk
        const newline = buffered.indexOf('\n')
        if (newline >= 0) resolve(JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>)
      })
      child.once('exit', () => { reject(new Error('host exited before it was ready')) })
    })
    const banner = await ready
    assert.equal(typeof banner.port, 'number')
    assert.equal(banner.node, process.version)
    const exited = once(child, 'exit')
    child.stdin.end()
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => { reject(new Error('host kept running after stdin closed')) }, 10_000).unref()
    })
    const [code] = await Promise.race([exited, timeout])
    assert.equal(code, 0)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
})

/** A plugin whose dispose never settles, and a tool that tells where its snapshot is. Runs in the host process. */
const STUCK_PLUGIN = [
  "export const name = 'stuck'",
  "export const inject = ['tools']",
  'export function apply(ctx: any) {',
  "  ctx.tools.register({ name: 'where', execute: () => new URL('.', import.meta.url).href })",
  "  ctx.effect(() => () => new Promise(() => undefined))",
  '}',
  '',
].join('\n')

async function hostWithStuckPlugin(): Promise<{ child: ChildProcessByStdio<Writable, Readable, null>; snapshot: string }> {
  const pluginsDir = await mkdtemp(path.join(tmpdir(), 'cordis-plugins-'))
  const packageDir = path.join(pluginsDir, 'stuck')
  await mkdir(packageDir)
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'stuck', version: '1.0.0', type: 'module', main: './index.ts', oharness: IN_PROCESS }))
  await writeFile(path.join(packageDir, 'index.ts'), STUCK_PLUGIN)
  const { child, banner } = await startedHost({ OH_CORDIS_PLUGINS_DIR: pluginsDir })
  const host = { port: banner.port, token: banner.token } as unknown as RunningHost
  const installed = await installConfirmed(host, packageDir)
  assert.equal(installed.json.status, 'active', JSON.stringify(installed.json))
  const where = await call(host, '/v1/tools/invoke', { body: { name: 'where', args: {} } })
  const snapshot = fileURLToPath(String(asRecord(where.json).value))
  assert.equal(existsSync(snapshot), true)
  return { child, snapshot }
}

async function exitAfter(child: ChildProcessByStdio<Writable, Readable, null>, stop: () => void): Promise<{ code: unknown; ms: number }> {
  const exited = once(child, 'exit')
  const started = Date.now()
  stop()
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => { reject(new Error('host kept running after its shutdown timeout')) }, 15_000).unref()
  })
  const [code] = await Promise.race([exited, timeout])
  return { code, ms: Date.now() - started }
}

/** A dispose that never settles must not keep the host alive, nor leave the snapshot behind. */
test('host exits 1 within the shutdown timeout when a dispose hangs, and removes the snapshot', async () => {
  const { child, snapshot } = await hostWithStuckPlugin()
  try {
    const { code, ms } = await exitAfter(child, () => { child.stdin.end() })
    assert.equal(code, 1)
    assert.ok(ms >= SHUTDOWN_TIMEOUT_MS - 500 && ms < SHUTDOWN_TIMEOUT_MS + 5_000, `exited after ${String(ms)} ms`)
    assert.equal(existsSync(snapshot), false)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
})

test('SIGTERM takes the same path: exit 1 after the timeout, snapshot removed', { skip: process.platform === 'win32' ? 'Windows has no catchable SIGTERM' : false }, async () => {
  const { child, snapshot } = await hostWithStuckPlugin()
  try {
    const { code } = await exitAfter(child, () => { child.kill('SIGTERM') })
    assert.equal(code, 1)
    assert.equal(existsSync(snapshot), false)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
})
