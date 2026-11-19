import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startHost, CALL_CONCURRENCY } from '../src/server.ts'
import { createShutdown } from '../src/shutdown.ts'
import { asRecord, call, IN_PROCESS, installConfirmed, preview, tempPackage, testPluginRoots, withHost } from './client.ts'

const SLOW_PLUGIN = [
  "export const inject = ['tools']",
  'export function apply(ctx: any) {',
  "  ctx.tools.register({ name: 'hang', execute() { return new Promise(() => {}) } })",
  "  ctx.tools.register({ name: 'aborted_after', async execute(_args: unknown, exec: { signal: AbortSignal }) {",
  '    await new Promise((resolve) => setTimeout(resolve, 100))',
  '    return exec.signal.aborted',
  '  } })',
  '}',
  '',
].join('\n')

async function slowPackage(): Promise<string> {
  return tempPackage({
    'package.json': JSON.stringify({ name: 'slow', version: '1.0.0', type: 'module', main: './index.ts' }),
    'index.ts': SLOW_PLUGIN,
  })
}

test('shutdown exits 1 after the timeout when close never settles, and cleans up first', async () => {
  const events: string[] = []
  let exited: (code: number) => void = () => undefined
  const done = new Promise<number>((resolve) => { exited = resolve })
  const shutdown = createShutdown({
    close: () => new Promise<void>(() => { events.push('close') }),
    abandon: () => { events.push('abandon') },
    exit: (code) => { events.push(`exit ${String(code)}`); exited(code) },
    timeoutMs: 50,
  })
  // The shutdown timer is unref'd, as in the host; hold the loop open while we wait for it.
  const keepAlive = setInterval(() => undefined, 1000)
  void shutdown()
  void shutdown()
  try {
    assert.equal(await done, 1)
  } finally {
    clearInterval(keepAlive)
  }
  assert.deepEqual(events, ['close', 'abandon', 'exit 1'])
})

test('shutdown exits 0 when close settles in time', async () => {
  const codes: number[] = []
  const shutdown = createShutdown({ close: async () => undefined, abandon: () => { codes.push(-1) }, exit: (code) => { codes.push(code) }, timeoutMs: 1000 })
  await shutdown()
  assert.deepEqual(codes, [0])
})

test('abandoning the runtime removes the snapshot folders synchronously', async () => {
  const host = await startHost({ pluginRoots: testPluginRoots })
  try {
    await installConfirmed(host, await slowPackage())
    const dirs = host.runtime.snapshotDirs()
    assert.equal(dirs.length, 1)
    assert.equal(existsSync(dirs[0] ?? ''), true)
    host.runtime.abandon()
    assert.equal(existsSync(dirs[0] ?? ''), false)
  } finally {
    await host.close()
  }
})

test('a tool call that never settles answers after the call timeout', async () => {
  const host = await startHost({ pluginRoots: testPluginRoots, callTimeoutMs: 300 })
  try {
    await installConfirmed(host, await slowPackage())
    const response = await call(host, '/v1/tools/invoke', { body: { name: 'hang', args: {} } })
    assert.equal(asRecord(response.json).ok, false)
    assert.match(String(asRecord(response.json).error), /timed out/)
  } finally {
    await host.close()
  }
})

test('calls beyond the concurrency limit are refused with 429', async () => {
  const host = await startHost({ pluginRoots: testPluginRoots, callTimeoutMs: 3000 })
  try {
    await installConfirmed(host, await slowPackage())
    const hanging = Array.from({ length: CALL_CONCURRENCY }, () => call(host, '/v1/tools/invoke', { body: { name: 'hang', args: {} } }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    const extra = await call(host, '/v1/tools/invoke', { body: { name: 'hang', args: {} } })
    assert.equal(extra.status, 429)
    assert.equal(asRecord(extra.json).code, 'busy')
    await Promise.all(hanging)
  } finally {
    await host.close()
  }
})

test('a normal request does not abort its own call', async () => {
  await withHost(async (host) => {
    await installConfirmed(host, await slowPackage())
    const response = await call(host, '/v1/tools/invoke', { body: { name: 'aborted_after', args: {} } })
    assert.deepEqual(asRecord(response.json), { ok: true, value: false })
  })
})

test('a loaded package whose files changed is not answered from the cache', async () => {
  await withHost(async (host) => {
    const dir = await slowPackage()
    const first = await installConfirmed(host, dir)
    assert.equal(first.json.status, 'active')
    const old = await preview(host, dir)
    await writeFile(path.join(dir, 'index.ts'), `${SLOW_PLUGIN}// changed\n`)
    const stale = await call(host, '/v1/plugins/install', { body: { packageDir: dir, confirmation: { accept: true, digest: old.digest } } })
    assert.equal(stale.status, 409)
    assert.equal(asRecord(stale.json).code, 'confirmation-mismatch')
  })
})

test('on Windows, a host file named with other letter case is still refused', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('letter case only aliases a path on Windows')
    return
  }
  // A host module a plugin may import by its own spelling. Only the case of its folder changes, so
  // the same file is refused only because the letter case differs from the allowed prefix.
  const allowed = fileURLToPath(new URL('../src/errors.ts', import.meta.url))
  const swapped = path.join(path.dirname(path.dirname(allowed)), 'SRC', 'errors.ts')
  for (const oharness of [IN_PROCESS, undefined]) {
    for (const [target, refused] of [[allowed, false], [swapped, true]] as const) {
      const dir = await tempPackage({
        'package.json': JSON.stringify({ name: 'case', version: '1.0.0', type: 'module', ...(oharness ? { oharness } : {}) }),
        'index.ts': `import ${JSON.stringify(pathToFileURL(target).href)}
export function apply() {}
`,
      })
      await withHost(async (host) => {
        const seen = await preview(host, dir)
        const install = await call(host, '/v1/plugins/install', { body: { packageDir: dir, confirmation: { accept: true, digest: seen.digest } } })
        if (!refused) {
          assert.equal(install.status, 200, `${target}: ${JSON.stringify(install.json)}`)
          return
        }
        assert.equal(install.status, 400, JSON.stringify(install.json))
        assert.equal(asRecord(install.json).code, 'path-rejected')
      })
    }
  }
})
