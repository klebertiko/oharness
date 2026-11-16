import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
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

/**
 * The rescoped names must not be installed. This checks the disk and the
 * lockfile, not `require.resolve`: from Node 24 the `registerHooks` alias
 * also remaps `require`, so resolving the alias succeeds by design.
 */
function assertNotInstalled(name: string): void {
  assert.equal(existsSync(new URL(`../node_modules/${name}/package.json`, import.meta.url)), false, `${name} is installed`)
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as {
    packages: Record<string, unknown>
  }
  assert.equal(lock.packages[`node_modules/${name}`], undefined, `lockfile has ${name}`)
}

test('cordis pin is the DSH upstream tarball, not the rescoped package', () => {
  const installed = JSON.parse(readFileSync(require.resolve('cordis/package.json'), 'utf8')) as { version: string }
  const locked = lockEntry('cordis')
  assert.equal(installed.version, CORDIS_VERSION)
  assert.equal(locked.version, CORDIS_VERSION)
  assert.equal(locked.integrity, CORDIS_INTEGRITY)
  assert.equal(CORDIS_GIT_HEAD, CORDIS_DSH_VENDOR_COMMIT)
  assert.notEqual(installed.version, CORDIS_RESCOPED_VERSION_NOT_USED)
  assertNotInstalled('@deepseek-ai/cordis')
  assert.equal(upstream.Context, aliased.Context)
})

test('schemastery pin records the npm tarball and the different DSH vendor commit', () => {
  const installed = JSON.parse(readFileSync(require.resolve('schemastery/package.json'), 'utf8')) as { version: string }
  const locked = lockEntry('schemastery')
  assert.equal(installed.version, SCHEMASTERY_VERSION)
  assert.equal(locked.version, SCHEMASTERY_VERSION)
  assert.equal(locked.integrity, SCHEMASTERY_INTEGRITY)
  assert.notEqual(SCHEMASTERY_NPM_GIT_HEAD, SCHEMASTERY_DSH_VENDOR_COMMIT)
  assertNotInstalled('@deepseek-ai/schemastery')
  assertNotInstalled('@deepseek-ai/dsh-tools')
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
