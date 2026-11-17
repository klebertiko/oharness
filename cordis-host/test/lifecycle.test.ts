import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { packageRoot } from './client.ts'

/** The parent holds the host's stdin. When the parent dies the pipe closes, and the host must stop listening. */
test('host exits when the parent closes its stdin', async () => {
  const child = spawn(
    process.execPath,
    ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', '--import', './src/register-alias.ts', 'src/main.ts'],
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
