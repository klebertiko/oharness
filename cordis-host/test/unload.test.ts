import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { asRecord, call, directoryPickerDir, installConfirmed, ourPluginDir, tempPackage, withHost } from './client.ts'

function versioned(version: string): Promise<string> {
  return tempPackage({
    'package.json': JSON.stringify({ name: 'swap', version, type: 'module', main: './index.ts', oharness: { runtime: 'isolated', capabilities: [] } }),
    'index.ts': [
      "export const name = 'swap'",
      "export const inject = ['tools']",
      'export function apply(ctx) {',
      `  ctx.tools.register({ name: 'swap_version', description: 'Version.', async execute() { return { version: '${version}', pid: process.pid } } })`,
      '}',
      '',
    ].join('\n'),
  })
}

test('unload stops an isolated plugin, drops it and its snapshot, and frees its tool', async () => {
  await withHost(async (host) => {
    const installed = await installConfirmed(host, ourPluginDir)
    assert.equal(installed.json.status, 'active')
    const [snapshot] = host.runtime.snapshotDirs()
    assert.ok(snapshot !== undefined && existsSync(snapshot))
    const gone = await call(host, '/v1/plugins/unload', { body: { name: String(installed.json.name) } })
    assert.equal(gone.status, 200)
    assert.deepEqual(asRecord(gone.json), { ok: true, name: installed.json.name })
    assert.deepEqual(asRecord((await call(host, '/v1/plugins')).json).plugins, [])
    assert.equal(existsSync(snapshot), false)
    assert.deepEqual(host.runtime.snapshotDirs(), [])
    const echo = await call(host, '/v1/tools/invoke', { body: { name: 'proof_echo', args: { text: 'x' } } })
    assert.equal(asRecord(echo.json).ok, false)
  })
})

test('a plugin can be unloaded and another version installed without restarting the host', async () => {
  await withHost(async (host) => {
    const one = await versioned('1.0.0')
    assert.equal((await installConfirmed(host, one)).json.status, 'active')
    const first = asRecord(asRecord((await call(host, '/v1/tools/invoke', { body: { name: 'swap_version', args: {} } })).json).value)
    assert.equal(first.version, '1.0.0')
    // While 1.0.0 runs, a second package with the same tool is refused.
    const two = await versioned('2.0.0')
    assert.equal((await installConfirmed(host, two)).json.status, 'failed')
    assert.equal((await call(host, '/v1/plugins/unload', { body: { name: 'swap' } })).status, 200)
    const second = await installConfirmed(host, two)
    assert.equal(second.json.status, 'active')
    const after = asRecord(asRecord((await call(host, '/v1/tools/invoke', { body: { name: 'swap_version', args: {} } })).json).value)
    assert.equal(after.version, '2.0.0')
    assert.notEqual(after.pid, first.pid)
  })
})

test('unload disposes an in-process plugin and removes its service', async () => {
  await withHost(async (host) => {
    const installed = await installConfirmed(host, directoryPickerDir)
    assert.equal(installed.json.status, 'active')
    const has = async (): Promise<boolean> => {
      const rows = asRecord((await call(host, '/v1/services')).json).services as unknown[]
      return rows.some((row) => asRecord(row).name === 'directoryPicker')
    }
    assert.equal(await has(), true)
    const gone = await call(host, '/v1/plugins/unload', { body: { name: String(installed.json.name) } })
    assert.equal(gone.status, 200)
    assert.deepEqual(asRecord((await call(host, '/v1/plugins')).json).plugins, [])
    assert.equal(host.runtime.context.get('directoryPicker' as never), undefined)
  })
})

test('unload of an unknown name is 404, and a bad body is 400', async () => {
  await withHost(async (host) => {
    assert.equal((await call(host, '/v1/plugins/unload', { body: { name: 'nobody' } })).status, 404)
    assert.equal((await call(host, '/v1/plugins/unload', { body: {} })).status, 400)
    assert.equal((await call(host, '/v1/plugins/unload', { body: { name: 'x' }, token: null })).status, 401)
  })
})

