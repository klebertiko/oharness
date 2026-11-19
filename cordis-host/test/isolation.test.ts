import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { asRecord, call, installConfirmed, preview, tempPackage, withHost } from './client.ts'
import type { RunningHost } from '../src/server.ts'

/**
 * A plugin whose `probe` tool tries one thing the permission model gates and
 * reports the error code, or "ok". It runs in its own process.
 */
const PROBE_PLUGIN = [
  "import { readFileSync, writeFileSync } from 'node:fs'",
  "import { execFileSync } from 'node:child_process'",
  "import imported from 'node:process'",
  "export const name = 'probe'",
  "export const inject = ['tools']",
  'function attempt(run: () => unknown): string {',
  "  try { run(); return 'ok' } catch (error) { return String((error as { code?: unknown }).code ?? 'error') }",
  '}',
  'export function apply(ctx: any) {',
  '  ctx.tools.register({',
  "    name: 'probe',",
  '    execute(args: { op: string; target?: string }) {',
  "      if (args.op === 'read') return attempt(() => readFileSync(args.target ?? ''))",
  "      if (args.op === 'write') return attempt(() => writeFileSync(args.target ?? '', 'written'))",
  "      if (args.op === 'spawn') return attempt(() => execFileSync(process.execPath, ['--version']))",
  "      if (args.op === 'self') return attempt(() => readFileSync(new URL('./index.ts', import.meta.url)))",
  "      if (args.op === 'env') return process.env.OH_ISOLATION_TEST_SECRET ?? 'absent'",
  "      if (args.op === 'pid') return process.pid",
  "      if (args.op === 'debug') return [process, globalThis.process, imported, process.getBuiltinModule('node:process')].map((p: any) => attempt(() => p._debugProcess(process.ppid)))",
  "      if (args.op === 'kill') return attempt(() => process.kill(Number(args.target === 'self' ? process.pid : process.ppid), args.target === 'self' ? 0 : (args.target ?? 0) as any))",
  "      if (args.op === 'raw-kill') return attempt(() => { const errno = (process as any)._kill(process.ppid, 0); if (errno !== 0) throw Object.assign(new Error('errno'), { code: String(errno) }) })",
  "      if (args.op === 'redefine') return [attempt(() => Object.defineProperty(process, 'kill', { value: () => true })), attempt(() => { if (!delete (process as any)._debugProcess) throw new Error('kept') })]",
  "      if (args.op === 'spawn-debug') return attempt(() => execFileSync(process.execPath, ['-e', `process._debugProcess(${String(process.ppid)})`], { stdio: 'ignore' }))",
  "      if (args.op === 'inspector') return fetch('http://127.0.0.1:9229/json/list').then(() => 'reachable', () => 'unreachable')",
  "      if (args.op === 'can-write') return (process as any).permission?.has('fs.write') ?? 'no permission model'",
  "      return 'unknown op'",
  '    },',
  '  })',
  '}',
  '',
].join('\n')

async function probePackage(oharness?: Record<string, unknown>): Promise<string> {
  return tempPackage({
    'package.json': JSON.stringify({ name: 'probe', version: '1.0.0', type: 'module', main: './index.ts', ...(oharness ? { oharness } : {}) }),
    'index.ts': PROBE_PLUGIN,
  })
}

async function probe(host: RunningHost, op: string, target?: string): Promise<unknown> {
  const response = await call(host, '/v1/tools/invoke', { body: { name: 'probe', args: { op, target } } })
  assert.equal(response.status, 200)
  const body = asRecord(response.json)
  assert.equal(body.ok, true, JSON.stringify(body))
  return body.value
}

/** Ask the plugin, after an attempt on the host, whether the host's inspector answers. Waits for it to open. */
async function inspectorAfterWait(host: RunningHost): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return probe(host, 'inspector')
}

async function outsideFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cordis-outside-'))
  const file = path.join(dir, 'secret.txt')
  await writeFile(file, 'not for the plugin')
  return file
}

test('isolated is the default runtime and an undeclared capability list grants nothing', async () => {
  await withHost(async (host) => {
    const seen = await preview(host, await probePackage())
    assert.equal(seen.runtime, 'isolated')
    assert.equal(seen.runtimeDefaulted, true)
    assert.deepEqual(seen.capabilities, [])
    assert.equal(seen.capabilitiesDeclared, false)
    const isolation = asRecord(seen.isolation)
    assert.deepEqual(isolation.enforced, ['files', 'processes', 'credentials'])
  })
})

test('an isolated plugin runs in its own process', async () => {
  await withHost(async (host) => {
    const installed = await installConfirmed(host, await probePackage())
    assert.equal(installed.status, 200, JSON.stringify(installed.json))
    assert.equal(installed.json.status, 'active')
    assert.equal(installed.json.runtime, 'isolated')
    const pid = await probe(host, 'pid')
    assert.equal(typeof pid, 'number')
    assert.notEqual(pid, process.pid)
  })
})

test('without "files" the plugin cannot read outside its snapshot, but can read its own files', async () => {
  await withHost(async (host) => {
    const installed = await installConfirmed(host, await probePackage({ capabilities: [] }))
    assert.equal(installed.json.status, 'active', JSON.stringify(installed.json))
    assert.equal(await probe(host, 'read', await outsideFile()), 'ERR_ACCESS_DENIED')
    assert.equal(await probe(host, 'read', path.join(process.cwd(), 'test', 'client.ts')), 'ERR_ACCESS_DENIED')
    assert.equal(await probe(host, 'self'), 'ok')
  })
})

test('without "files" the plugin cannot write to disk', async () => {
  await withHost(async (host) => {
    await installConfirmed(host, await probePackage({ capabilities: [] }))
    const target = path.join(path.dirname(await outsideFile()), 'written.txt')
    assert.equal(await probe(host, 'write', target), 'ERR_ACCESS_DENIED')
    assert.equal(existsSync(target), false)
  })
})

test('without "processes" the plugin cannot start a process', async () => {
  await withHost(async (host) => {
    await installConfirmed(host, await probePackage({ capabilities: [] }))
    assert.equal(await probe(host, 'spawn'), 'ERR_ACCESS_DENIED')
  })
})

test('without "credentials" the plugin does not see the host environment', async () => {
  process.env.OH_ISOLATION_TEST_SECRET = 'host-secret'
  try {
    await withHost(async (host) => {
      await installConfirmed(host, await probePackage({ capabilities: [] }))
      assert.equal(await probe(host, 'env'), 'absent')
    })
  } finally {
    delete process.env.OH_ISOLATION_TEST_SECRET
  }
})

test('a confirmed capability is granted, and only that one', async () => {
  await withHost(async (host) => {
    await installConfirmed(host, await probePackage({ capabilities: ['files'] }))
    const secret = await outsideFile()
    assert.equal(await probe(host, 'read', secret), 'ok')
    const target = path.join(path.dirname(secret), 'written.txt')
    assert.equal(await probe(host, 'write', target), 'ok')
    assert.equal(existsSync(target), true)
    assert.equal(await probe(host, 'spawn'), 'ERR_ACCESS_DENIED')
  })
  await withHost(async (host) => {
    await installConfirmed(host, await probePackage({ capabilities: ['processes'] }))
    assert.equal(await probe(host, 'spawn'), 'ok')
    assert.equal(await probe(host, 'read', await outsideFile()), 'ERR_ACCESS_DENIED')
  })
})

test('in-process needs every capability declared, because it runs with the host reach', async () => {
  await withHost(async (host) => {
    const partial = await call(host, '/v1/plugins/preview', {
      body: { packageDir: await probePackage({ runtime: 'in-process', capabilities: ['files'] }) },
    })
    assert.equal(partial.status, 400)
    assert.equal(asRecord(partial.json).code, 'runtime-not-supported')
    const full = await preview(host, await probePackage({ runtime: 'in-process', capabilities: ['files', 'network', 'processes', 'credentials'] }))
    assert.equal(full.runtime, 'in-process')
  })
})

test('a malformed message from the plugin process stops that plugin', async () => {
  await withHost(async (host) => {
    const dir = await tempPackage({
      'package.json': JSON.stringify({ name: 'liar', version: '1.0.0', type: 'module', main: './index.ts' }),
      'index.ts': "export function apply() { process.send?.({ type: 'loaded', status: 'active', extra: { '__proto__': 1 } }); process.send?.({ type: 'nonsense' }) }\n",
    })
    const installed = await installConfirmed(host, dir)
    assert.notEqual(installed.json.status, 'active', JSON.stringify(installed.json))
  })
})

test('a plugin process that dies fails its tool calls instead of hanging the host', async () => {
  await withHost(async (host) => {
    const dir = await tempPackage({
      'package.json': JSON.stringify({ name: 'dies', version: '1.0.0', type: 'module', main: './index.ts' }),
      'index.ts': "export const inject = ['tools']\nexport function apply(ctx: any) { ctx.tools.register({ name: 'die', execute() { process.exit(3) } }) }\n",
    })
    const installed = await installConfirmed(host, dir)
    assert.equal(installed.json.status, 'active', JSON.stringify(installed.json))
    const response = await call(host, '/v1/tools/invoke', { body: { name: 'die', args: {} } })
    assert.equal(asRecord(response.json).ok, false)
    const plugins = asRecord((await call(host, '/v1/plugins')).json).plugins
    assert.ok(Array.isArray(plugins))
    assert.equal(asRecord(plugins[0]).status, 'failed')
  })
})

test('without "processes" the plugin cannot open the host inspector or signal the host', async () => {
  await withHost(async (host) => {
    const installed = await installConfirmed(host, await probePackage({ capabilities: [] }))
    assert.equal(installed.json.status, 'active', JSON.stringify(installed.json))
    // process, globalThis.process, `import process from 'node:process'` and getBuiltinModule are one object.
    assert.deepEqual(await probe(host, 'debug'), ['ERR_ACCESS_DENIED', 'ERR_ACCESS_DENIED', 'ERR_ACCESS_DENIED', 'ERR_ACCESS_DENIED'])
    for (const signal of ['0', 'SIGUSR1', 'SIGTERM', 'SIGKILL']) {
      assert.equal(await probe(host, 'kill', signal), 'ERR_ACCESS_DENIED', signal)
    }
    assert.equal(await probe(host, 'raw-kill'), 'ERR_ACCESS_DENIED')
    const [redefined, deleted] = await probe(host, 'redefine') as unknown[]
    assert.notEqual(redefined, 'ok')
    assert.notEqual(deleted, 'ok')
    assert.equal(await probe(host, 'debug').then((codes) => (codes as unknown[])[0]), 'ERR_ACCESS_DENIED')
    // The plugin may still signal itself, and the host is still alive and answering.
    assert.equal(await probe(host, 'kill', 'self'), 'ok')
    assert.equal(await inspectorAfterWait(host), 'unreachable')
  })
})

test('with "processes" a spawned process still cannot open the host inspector', async () => {
  await withHost(async (host) => {
    await installConfirmed(host, await probePackage({ capabilities: ['processes'] }))
    await probe(host, 'spawn-debug')
    assert.equal(await inspectorAfterWait(host), 'unreachable')
  })
})

test('the permission model is on in the plugin process: no write grant without "files"', async () => {
  await withHost(async (host) => {
    await installConfirmed(host, await probePackage({ capabilities: [] }))
    assert.equal(await probe(host, 'can-write'), false)
  })
})
