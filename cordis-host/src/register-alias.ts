/**
 * One Cordis module instance for the host and for plugins.
 *
 * DSH plugins import `@deepseek-ai/cordis` because DSH rescopes the package.
 * Installing that name from the registry would pull `@deepseek-ai/cordis`
 * 4.1.0, which is not the rc.11 tarball. The hook below resolves the
 * specifier to npm `cordis`, the pinned rc.11 copy.
 *
 * `@deepseek-ai/dsh-tools` resolves to the subset in dsh-tools-subset.ts.
 * That module is not the DSH tools package: it does not validate arguments
 * and it does not run the DSH tool pipeline.
 *
 * `@deepseek-ai/schemastery` resolves to npm `schemastery@3.18.0`. See pin.ts
 * for why that commit is not DSH's vendored Schemastery.
 */
import { registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const subsetUrl = new URL('./dsh-tools-subset.ts', import.meta.url).href

function remap(specifier: string, from: string, to: string): string | undefined {
  if (specifier === from) return to
  const prefix = `${from}/`
  if (specifier.startsWith(prefix)) return to + specifier.slice(from.length)
  return undefined
}

const directoryPickerUrl = new URL('../vendor/dsh/directory-picker/index.ts', import.meta.url).href

/** Host-owned, pinned code a plugin may import: src, vendor and node_modules. Not test/ or proofs/. */
const hostRootUrls = ['../src/', '../vendor/', '../node_modules/'].map((dir) => new URL(dir, import.meta.url).href)

/** Snapshot folders of installed plugins, as file URLs ending in `/`. */
const snapshotRoots = new Set<string>()

function rootUrl(dir: string): string {
  return pathToFileURL(dir.endsWith(path.sep) ? dir : dir + path.sep).href
}

/** Confine modules loaded from `dir` to `dir` itself, Node built-ins, and this host's own files. */
export function confineSnapshot(dir: string): void {
  snapshotRoots.add(rootUrl(dir))
}

export function releaseSnapshot(dir: string): void {
  snapshotRoots.delete(rootUrl(dir))
}

export function isConfinedSnapshot(dir: string): boolean {
  return snapshotRoots.has(rootUrl(dir))
}

export class OutsidePackageError extends Error {
  readonly code = 'path-rejected'
  constructor() {
    super('the plugin imports a file outside its package')
    this.name = 'OutsidePackageError'
  }
}

function isBare(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !path.isAbsolute(specifier) && !/^[a-z][a-z0-9+.-]*:/iu.test(specifier)
}

function snapshotOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  for (const root of snapshotRoots) if (url.startsWith(root)) return root
  return undefined
}

function confined<T extends { url: string }>(parentURL: string | undefined, result: T): T {
  const root = snapshotOf(parentURL)
  if (root === undefined) return result
  if (result.url.startsWith('node:') || result.url.startsWith(root) || hostRootUrls.some((host) => result.url.startsWith(host))) return result
  throw new OutsidePackageError()
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const cordis = remap(specifier, '@deepseek-ai/cordis', 'cordis')
    // Aliases always resolve from this host, so plugin and host share one pinned copy.
    const fromHost = { ...context, parentURL: import.meta.url }
    if (cordis !== undefined) return nextResolve(cordis, fromHost)
    const schema = remap(specifier, '@deepseek-ai/schemastery', 'schemastery')
    if (schema !== undefined) return nextResolve(schema, fromHost)
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: subsetUrl, shortCircuit: true }
    }
    if (specifier === '@oharness/dsh-directory-picker') {
      return { url: directoryPickerUrl, shortCircuit: true }
    }
    if (snapshotOf(context.parentURL) !== undefined && isBare(specifier)) {
      // A snapshot lives outside this package, so a bare name falls back to
      // the host's own pinned node_modules when the plugin does not ship it.
      try {
        return confined(context.parentURL, nextResolve(specifier, context))
      } catch (error) {
        if (error instanceof OutsidePackageError) throw error
        return nextResolve(specifier, fromHost)
      }
    }
    return confined(context.parentURL, nextResolve(specifier, context))
  },
})
