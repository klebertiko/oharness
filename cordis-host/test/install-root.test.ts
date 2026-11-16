import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startHost, type RunningHost } from '../src/server.ts'
import { asRecord, call, ourPluginDir, preview, tempPackage } from './client.ts'

async function withRoot(roots: readonly string[], run: (host: RunningHost) => Promise<void>): Promise<void> {
  const host = await startHost({ pluginRoots: roots })
  try {
    await run(host)
  } finally {
    await host.close()
  }
}

function plugin(marker: string): string {
  return `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'ran')\nexport const name = 'swap'\nexport function apply() {}\n`
}

test('preview and install refuse a package outside the plugin root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cordis-root-'))
  await withRoot([root], async (host) => {
    const response = await call(host, '/v1/plugins/preview', { body: { packageDir: ourPluginDir } })
    assert.equal(response.status, 400)
    assert.equal(asRecord(response.json).code, 'path-rejected')
    const install = await call(host, '/v1/plugins/install', {
      body: { packageDir: ourPluginDir, confirmation: { accept: true, digest: 'x' } },
    })
    assert.equal(install.status, 400)
    assert.equal(asRecord(install.json).code, 'path-rejected')
  })
})

test('the plugin root itself is not a package', async () => {
  const root = await tempPackage({ 'package.json': JSON.stringify({ name: 'root', version: '1.0.0' }), 'index.ts': 'export function apply() {}\n' })
  await withRoot([root], async (host) => {
    const response = await call(host, '/v1/plugins/preview', { body: { packageDir: root } })
    assert.equal(response.status, 400)
  })
})

test('a link inside the plugin root that points outside it is refused', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cordis-root-'))
  const link = path.join(root, 'escape')
  try {
    await symlink(ourPluginDir, link, 'junction')
  } catch {
    t.skip('cannot create a directory link here')
    return
  }
  await withRoot([root], async (host) => {
    const response = await call(host, '/v1/plugins/preview', { body: { packageDir: link } })
    assert.equal(response.status, 400)
  })
})

test('changing the entry code after preview invalidates the confirmation', async () => {
  const marker = path.join(await mkdtemp(path.join(tmpdir(), 'cordis-marker-')), 'ran.txt')
  const dir = await tempPackage({
    'package.json': JSON.stringify({ name: 'swap', version: '1.0.0', oharness: { capabilities: ['files'] } }),
    'index.ts': 'export const name = \'swap\'\nexport function apply() {}\n',
  })
  await withRoot([path.dirname(dir)], async (host) => {
    const seen = await preview(host, dir)
    await writeFile(path.join(dir, 'index.ts'), plugin(marker))
    const install = await call(host, '/v1/plugins/install', {
      body: { packageDir: dir, confirmation: { accept: true, digest: seen.digest } },
    })
    assert.equal(install.status, 409)
    assert.equal(asRecord(install.json).code, 'confirmation-mismatch')
    assert.equal(existsSync(marker), false)
  })
})

test('changing a file the entry imports also changes the digest', async () => {
  const dir = await tempPackage({
    'package.json': JSON.stringify({ name: 'dep', version: '1.0.0', oharness: { capabilities: ['files'] } }),
    'index.ts': 'import { x } from \'./lib/x.ts\'\nexport const name = x\nexport function apply() {}\n',
    'lib/x.ts': 'export const x = \'dep\'\n',
  })
  await withRoot([path.dirname(dir)], async (host) => {
    const before = await preview(host, dir)
    await writeFile(path.join(dir, 'lib', 'x.ts'), 'export const x = \'changed\'\n')
    const after = await preview(host, dir)
    assert.notEqual(after.digest, before.digest)
  })
})
