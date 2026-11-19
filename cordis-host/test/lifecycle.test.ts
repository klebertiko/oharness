import assert from 'node:assert/strict'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { once } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import test from 'node:test'
import { HOST_ARGS, packageRoot } from './client.ts'

async function startedHost(): Promise<{ child: ChildProcessByStdio<Writable, Readable, null>; banner: Record<string, unknown> }> {
  const child = spawn(process.execPath, [...HOST_ARGS], { cwd: packageRoot, stdio: ['pipe', 'pipe', 'inherit'] })
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
