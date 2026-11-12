import { realpath, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { HostError } from './errors.ts'
import { installDigest, warningText, type WarningText } from './warnings.ts'

export const CAPABILITIES = ['files', 'network', 'processes', 'credentials'] as const
export type Capability = (typeof CAPABILITIES)[number]

const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'] as const
const PACKAGE_JSON_LIMIT = 256 * 1024

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

async function readPackageJson(file: string): Promise<Record<string, unknown>> {
  const info = await stat(file)
  if (!info.isFile()) throw new HostError('path-rejected', 'package.json is not a file')
  if (info.size > PACKAGE_JSON_LIMIT) throw new HostError('path-rejected', 'package.json is too large')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    throw new HostError('path-rejected', 'package.json is not valid JSON')
  }
  if (!isRecord(parsed)) throw new HostError('path-rejected', 'package.json must be an object')
  return parsed
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
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (code === 'ENOENT' && main === undefined) continue
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

/** Read a package directory without importing its code. */
export async function inspectPackage(packageDir: string): Promise<PackagePreview> {
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
  const digest = installDigest({ name, version, realpath: root, runtime, capabilities, scripts })
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
    digest,
    warning: warningText(),
  }
}
