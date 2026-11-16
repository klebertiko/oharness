import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HostError } from './errors.ts'
import { installDigest, warningText, type WarningText } from './warnings.ts'

export const CAPABILITIES = ['files', 'network', 'processes', 'credentials'] as const
export type Capability = (typeof CAPABILITIES)[number]

const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'] as const
const PACKAGE_JSON_LIMIT = 256 * 1024
const TREE_FILE_LIMIT = 10_000
const TREE_BYTE_LIMIT = 64 * 1024 * 1024

export interface PackagePreview {
  readonly name: string
  readonly version: string
  readonly realpath: string
  readonly entry: string
  readonly runtime: 'in-process'
  readonly runtimeDefaulted: boolean
  readonly capabilities: readonly string[]
  readonly capabilitiesDeclared: boolean
  readonly scripts: readonly string[]
  readonly hasDshField: boolean
  readonly dshManifestVersion: number | undefined
  /** True when the package names a DSH bundle patch. This host does not apply it. */
  readonly bundlePatchIgnored: boolean
  /** sha256 of the package's files. Part of `digest`, so editing any file after preview voids the confirmation. */
  readonly tree: string
  readonly digest: string
  readonly warning: WarningText
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

/** Read package.json from one file descriptor so the size check and the bytes are the same file. */
async function readPackageJson(file: string): Promise<Record<string, unknown>> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(file, 'r')
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'EISDIR') throw new HostError('path-rejected', 'package.json was not found')
    throw error
  }
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new HostError('path-rejected', 'package.json is not a file')
    if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > PACKAGE_JSON_LIMIT) {
      throw new HostError('path-rejected', 'package.json is too large')
    }
    const buffer = Buffer.alloc(info.size)
    const { bytesRead } = await handle.read(buffer, 0, info.size, 0)
    let parsed: unknown
    try {
      parsed = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown
    } catch {
      throw new HostError('path-rejected', 'package.json is not valid JSON')
    }
    if (!isRecord(parsed)) throw new HostError('path-rejected', 'package.json must be an object')
    return parsed
  } finally {
    await handle.close()
  }
}

function readRuntime(oharness: Record<string, unknown> | undefined): { runtime: 'in-process'; runtimeDefaulted: boolean } {
  const declared = oharness?.runtime
  if (declared === undefined) return { runtime: 'in-process', runtimeDefaulted: true }
  if (declared === 'in-process') return { runtime: 'in-process', runtimeDefaulted: false }
  if (declared === 'isolated') {
    throw new HostError('runtime-not-supported', 'runtime isolated is not available; only in-process is supported')
  }
  throw new HostError('runtime-not-supported', 'runtime must be in-process')
}

function readCapabilities(oharness: Record<string, unknown> | undefined): { capabilities: string[]; capabilitiesDeclared: boolean } {
  const declared = oharness?.capabilities
  if (declared === undefined) {
    return { capabilities: [...CAPABILITIES], capabilitiesDeclared: false }
  }
  if (!Array.isArray(declared) || declared.some((item) => typeof item !== 'string')) {
    throw new HostError('bad-request', 'oharness.capabilities must be an array of strings')
  }
  const unknown = declared.filter((item) => !CAPABILITIES.includes(item as Capability))
  if (unknown.length > 0) {
    throw new HostError('bad-request', `unknown capabilities: ${unknown.join(', ')}`)
  }
  return { capabilities: [...new Set(declared)], capabilitiesDeclared: true }
}

function readScripts(scripts: unknown): string[] {
  if (scripts === undefined) return []
  if (!isRecord(scripts)) throw new HostError('path-rejected', 'scripts must be an object')
  const found: string[] = []
  for (const name of LIFECYCLE_SCRIPTS) {
    const value = scripts[name]
    if (typeof value === 'string' && value.trim() !== '') found.push(name)
  }
  return found
}

function readDsh(dsh: unknown): { hasDshField: boolean; dshManifestVersion: number | undefined; bundlePatchIgnored: boolean } {
  if (dsh === undefined) return { hasDshField: false, dshManifestVersion: undefined, bundlePatchIgnored: false }
  if (!isRecord(dsh)) throw new HostError('path-rejected', 'dsh must be an object')
  const version = dsh.manifestVersion
  const dshManifestVersion = version === undefined ? undefined : version
  if (dshManifestVersion !== undefined && dshManifestVersion !== 1) {
    throw new HostError('path-rejected', 'dsh.manifestVersion must be 1 when it is set')
  }
  const bundle = dsh.bundle
  const bundlePatchIgnored = isRecord(bundle) && bundle.patch !== undefined
  return {
    hasDshField: true,
    dshManifestVersion: dshManifestVersion === 1 ? 1 : undefined,
    bundlePatchIgnored,
  }
}

async function resolveEntry(root: string, main: unknown): Promise<string> {
  const candidates: string[] = []
  if (main !== undefined) {
    if (typeof main !== 'string' || main === '' || main.includes('\0')) {
      throw new HostError('path-rejected', 'main must be a relative file path')
    }
    if (path.isAbsolute(main) || /^[a-z]+:/i.test(main)) {
      throw new HostError('path-rejected', 'main must stay inside the package directory')
    }
    candidates.push(main)
  } else {
    candidates.push('index.ts', 'index.js', 'index.mjs')
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(root, candidate)
    let real: string
    try {
      real = await realpath(resolved)
    } catch (error) {
      if (errorCode(error) === 'ENOENT' && main === undefined) continue
      throw new HostError('path-rejected', 'plugin entry was not found inside the package directory')
    }
    if (!contained(root, real)) {
      throw new HostError('path-rejected', 'plugin entry escapes the package directory')
    }
    const info = await stat(real)
    if (!info.isFile()) throw new HostError('path-rejected', 'plugin entry is not a file')
    return real
  }
  throw new HostError('path-rejected', 'plugin entry was not found inside the package directory')
}

/**
 * sha256 over the package directory: each file's relative path and content
 * hash, in sorted order. A link anywhere in the tree is refused, so every
 * byte the digest covers is a byte inside the package directory.
 */
export async function treeDigest(root: string): Promise<string> {
  return (await readTree(root)).digest
}

interface TreeFile {
  readonly relative: string
  readonly bytes: Buffer
}

async function readTree(root: string): Promise<{ digest: string; files: TreeFile[] }> {
  const entries: string[] = []
  const collected: TreeFile[] = []
  let files = 0
  let bytes = 0
  async function walk(dir: string): Promise<void> {
    const names = (await readdir(dir)).sort()
    for (const name of names) {
      const full = path.join(dir, name)
      const info = await lstat(full)
      if (info.isSymbolicLink()) throw new HostError('path-rejected', 'the package contains a link')
      if (info.isDirectory()) {
        await walk(full)
        continue
      }
      if (!info.isFile()) throw new HostError('path-rejected', 'the package contains a special file')
      files += 1
      bytes += info.size
      if (files > TREE_FILE_LIMIT || bytes > TREE_BYTE_LIMIT) {
        throw new HostError('path-rejected', 'the package is too large to review')
      }
      const content = await readFile(full)
      const relative = path.relative(root, full).split(path.sep).join('/')
      collected.push({ relative, bytes: content })
      const hash = createHash('sha256').update(content).digest('hex')
      entries.push(`${relative}\0${hash}`)
    }
  }
  await walk(root)
  return { digest: createHash('sha256').update(entries.join('\n')).digest('hex'), files: collected }
}

export interface PackageSnapshot {
  /** Host-owned copy of the package; the caller cannot edit it. */
  readonly dir: string
  readonly entry: string
}

/**
 * Copy the package into a new private folder from the same buffers that are
 * hashed, and refuse if those bytes are not the confirmed tree. The import
 * then reads the copy, so editing the original after the check changes
 * nothing that runs.
 */
export async function snapshotPackage(preview: PackagePreview): Promise<PackageSnapshot> {
  const { digest, files } = await readTree(preview.realpath)
  if (digest !== preview.tree) {
    throw new HostError('confirmation-mismatch', 'the package changed after it was confirmed', preview)
  }
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'oharness-cordis-snap-')))
  for (const file of files) {
    const target = path.join(dir, ...file.relative.split('/'))
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, file.bytes, { flag: 'wx', mode: 0o600 })
  }
  return { dir, entry: path.join(dir, path.relative(preview.realpath, preview.entry)) }
}

async function realRoots(roots: readonly string[]): Promise<string[]> {
  const resolved: string[] = []
  for (const root of roots) {
    if (!path.isAbsolute(root)) throw new HostError('path-rejected', 'plugin root must be an absolute path')
    try {
      resolved.push(await realpath(root))
    } catch {
      // A root that does not exist yet admits nothing.
    }
  }
  return resolved
}

function strictlyInside(root: string, target: string): boolean {
  return target !== root && contained(root, target)
}

/**
 * Read a package directory without importing its code.
 *
 * The directory, after resolving links, must sit strictly inside one of
 * `roots`: the plugin folders the app controls. A caller with the token can
 * not point the host at an arbitrary folder.
 */
export async function inspectPackage(packageDir: string, roots: readonly string[]): Promise<PackagePreview> {
  if (typeof packageDir !== 'string' || packageDir === '' || packageDir.includes('\0')) {
    throw new HostError('path-rejected', 'packageDir must be an absolute path')
  }
  if (!path.isAbsolute(packageDir)) {
    throw new HostError('path-rejected', 'packageDir must be an absolute path')
  }
  let root: string
  try {
    root = await realpath(packageDir)
  } catch {
    throw new HostError('path-rejected', 'package directory was not found')
  }
  const allowed = await realRoots(roots)
  if (!allowed.some((base) => strictlyInside(base, root))) {
    throw new HostError('path-rejected', 'packageDir must be inside the plugin folder')
  }
  const rootInfo = await stat(root)
  if (!rootInfo.isDirectory()) throw new HostError('path-rejected', 'packageDir must be a directory')
  const manifestPath = path.join(root, 'package.json')
  if (!contained(root, await realpath(manifestPath).catch(() => ''))) {
    throw new HostError('path-rejected', 'package.json was not found')
  }
  const manifest = await readPackageJson(manifestPath)
  const name = manifest.name
  const version = manifest.version
  if (typeof name !== 'string' || name === '' || name.length > 214) {
    throw new HostError('path-rejected', 'package name is missing')
  }
  if (typeof version !== 'string' || version === '' || version.length > 64) {
    throw new HostError('path-rejected', 'package version is missing')
  }
  const oharness = manifest.oharness
  if (oharness !== undefined && !isRecord(oharness)) {
    throw new HostError('path-rejected', 'oharness must be an object')
  }
  const { runtime, runtimeDefaulted } = readRuntime(isRecord(oharness) ? oharness : undefined)
  const { capabilities, capabilitiesDeclared } = readCapabilities(isRecord(oharness) ? oharness : undefined)
  const scripts = readScripts(manifest.scripts)
  const dsh = readDsh(manifest.dsh)
  const entry = await resolveEntry(root, manifest.main)
  const tree = await treeDigest(root)
  const relativeEntry = path.relative(root, entry).split(path.sep).join('/')
  const digest = installDigest({ name, version, realpath: root, runtime, capabilities, scripts, entry: relativeEntry, tree })
  return {
    name,
    version,
    realpath: root,
    entry,
    runtime,
    runtimeDefaulted,
    capabilities,
    capabilitiesDeclared,
    scripts,
    hasDshField: dsh.hasDshField,
    dshManifestVersion: dsh.dshManifestVersion,
    bundlePatchIgnored: dsh.bundlePatchIgnored,
    tree,
    digest,
    warning: warningText(),
  }
}
