import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isConfinedSnapshot } from '../src/register-alias.ts'
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

test('install runs a host-owned snapshot, not the folder the caller can still edit', async () => {
  const dir = await tempPackage({
    'package.json': JSON.stringify({ name: 'snap', version: '1.0.0', oharness: { capabilities: ['files'] } }),
    'index.ts': 'const g = globalThis as { cordisSnapUrl?: string }\ng.cordisSnapUrl = import.meta.url\nexport const name = \'snap\'\nexport function apply() {}\n',
  })
  await withRoot([path.dirname(dir)], async (host) => {
    const seen = await preview(host, dir)
    const install = await call(host, '/v1/plugins/install', { body: { packageDir: dir, confirmation: { accept: true, digest: seen.digest } } })
    assert.equal(install.status, 200)
    const url = (globalThis as { cordisSnapUrl?: string }).cordisSnapUrl
    assert.equal(typeof url, 'string')
    // Compare resolved paths: tmpdir() can itself be a link (macOS /var).
    assert.equal(fileURLToPath(url ?? '').startsWith(await realpath(dir)), false)
    assert.equal(fileURLToPath(url ?? '').startsWith(dir), false)
  })
})

test('closing the host stops confining its snapshot folders', async () => {
  const dir = await tempPackage({
    'package.json': JSON.stringify({ name: 'snap-close', version: '1.0.0', oharness: { capabilities: ['files'] } }),
    'index.ts': 'const g = globalThis as { cordisSnapCloseUrl?: string }\ng.cordisSnapCloseUrl = import.meta.url\nexport const name = \'snap-close\'\nexport function apply() {}\n',
  })
  let snapshotDir = ''
  await withRoot([path.dirname(dir)], async (host) => {
    const seen = await preview(host, dir)
    const install = await call(host, '/v1/plugins/install', { body: { packageDir: dir, confirmation: { accept: true, digest: seen.digest } } })
    assert.equal(install.status, 200)
    snapshotDir = path.dirname(fileURLToPath((globalThis as { cordisSnapCloseUrl?: string }).cordisSnapCloseUrl ?? ''))
    assert.equal(isConfinedSnapshot(snapshotDir), true)
  })
  assert.equal(isConfinedSnapshot(snapshotDir), false)
})

test('a plugin cannot import the host test or proof files', async () => {
  const hostTestFile = pathToFileURL(fileURLToPath(new URL('./client.ts', import.meta.url))).href
  const dir = await tempPackage({
    'package.json': JSON.stringify({ name: 'host-test', version: '1.0.0', oharness: { capabilities: ['files'] } }),
    'index.ts': `import ${JSON.stringify(hostTestFile)}\nexport const name = 'host-test'\nexport function apply() {}\n`,
  })
  await withRoot([path.dirname(dir)], async (host) => {
    const seen = await preview(host, dir)
    const install = await call(host, '/v1/plugins/install', { body: { packageDir: dir, confirmation: { accept: true, digest: seen.digest } } })
    assert.equal(install.status, 400)
    assert.equal(asRecord(install.json).code, 'path-rejected')
  })
})

test('a plugin that imports a file outside its package is refused before that file runs', async () => {
  const outside = await mkdtemp(path.join(tmpdir(), 'cordis-outside-'))
  const marker = path.join(outside, 'ran.txt')
  const sneaky = path.join(outside, 'sneaky.ts')
  await writeFile(sneaky, plugin(marker))
  const dir = await tempPackage({
    'package.json': JSON.stringify({ name: 'escape', version: '1.0.0', oharness: { capabilities: ['files'] } }),
    'index.ts': `import ${JSON.stringify(pathToFileURL(sneaky).href)}\nexport const name = 'escape'\nexport function apply() {}\n`,
  })
  await withRoot([path.dirname(dir)], async (host) => {
    const seen = await preview(host, dir)
    const install = await call(host, '/v1/plugins/install', { body: { packageDir: dir, confirmation: { accept: true, digest: seen.digest } } })
    assert.equal(install.status, 400)
    assert.equal(asRecord(install.json).code, 'path-rejected')
    assert.equal(existsSync(marker), false)
  })
})
