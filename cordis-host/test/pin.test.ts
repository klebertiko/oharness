import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as upstream from 'cordis'
import * as aliased from '@deepseek-ai/cordis'
import {
  CORDIS_DSH_VENDOR_COMMIT,
  CORDIS_GIT_HEAD,
  CORDIS_INTEGRITY,
  CORDIS_RESCOPED_VERSION_NOT_USED,
  CORDIS_VERSION,
  DSH_PLUGIN_COMMIT,
  SCHEMASTERY_DSH_VENDOR_COMMIT,
  SCHEMASTERY_INTEGRITY,
  SCHEMASTERY_NPM_GIT_HEAD,
  SCHEMASTERY_VERSION,
  ZOD_INTEGRITY,
  ZOD_VERSION,
} from '../src/pin.ts'

const require = createRequire(import.meta.url)

function lockEntry(name: string): { version: string; integrity: string } {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as {
    packages: Record<string, { version?: string; integrity?: string }>
  }
  const entry = lock.packages[`node_modules/${name}`]
  assert.ok(entry, `lockfile is missing ${name}`)
  const version = entry.version
  const integrity = entry.integrity
  assert.equal(typeof version, 'string')
  assert.equal(typeof integrity, 'string')
  if (version === undefined || integrity === undefined) throw new Error(`lockfile is missing ${name}`)
  return { version, integrity }
}

test('cordis pin is the DSH upstream tarball, not the rescoped package', () => {
  const installed = JSON.parse(readFileSync(require.resolve('cordis/package.json'), 'utf8')) as { version: string }
  const locked = lockEntry('cordis')
  assert.equal(installed.version, CORDIS_VERSION)
  assert.equal(locked.version, CORDIS_VERSION)
  assert.equal(locked.integrity, CORDIS_INTEGRITY)
  assert.equal(CORDIS_GIT_HEAD, CORDIS_DSH_VENDOR_COMMIT)
  assert.notEqual(installed.version, CORDIS_RESCOPED_VERSION_NOT_USED)
  assert.throws(() => require.resolve('@deepseek-ai/cordis/package.json'))
  assert.equal(upstream.Context, aliased.Context)
})

test('schemastery pin records the npm tarball and the different DSH vendor commit', () => {
  const installed = JSON.parse(readFileSync(require.resolve('schemastery/package.json'), 'utf8')) as { version: string }
  const locked = lockEntry('schemastery')
  assert.equal(installed.version, SCHEMASTERY_VERSION)
  assert.equal(locked.version, SCHEMASTERY_VERSION)
  assert.equal(locked.integrity, SCHEMASTERY_INTEGRITY)
  assert.notEqual(SCHEMASTERY_NPM_GIT_HEAD, SCHEMASTERY_DSH_VENDOR_COMMIT)
  assert.throws(() => require.resolve('@deepseek-ai/schemastery/package.json'))
  assert.throws(() => require.resolve('@deepseek-ai/dsh-tools/package.json'))
})

test('zod pin matches the lockfile', () => {
  const locked = lockEntry('zod')
  assert.equal(locked.version, ZOD_VERSION)
  assert.equal(locked.integrity, ZOD_INTEGRITY)
})

test('vendored plugin bytes match the pinned DSH blobs', () => {
  const pin = JSON.parse(readFileSync(new URL('../vendor/dsh/PIN.json', import.meta.url), 'utf8')) as {
    commit: string
    files: { dest: string; blob: string }[]
  }
  assert.equal(pin.commit, DSH_PLUGIN_COMMIT)
  const repoRoot = new URL('../../', import.meta.url)
  for (const file of pin.files) {
    const bytes = readFileSync(new URL(file.dest, repoRoot))
    const hash = createHash('sha1')
    hash.update(`blob ${String(bytes.length)}\0`)
    hash.update(bytes)
    assert.equal(hash.digest('hex'), file.blob, file.dest)
  }
})
