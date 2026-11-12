import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context, type Fiber } from 'cordis'
import { CommandsService } from './commands-service.ts'
import { HostError } from './errors.ts'
import { inspectPackage, type PackagePreview } from './manifest.ts'
import { CORDIS_PACKAGE, CORDIS_VERSION, SCHEMASTERY_PACKAGE, SCHEMASTERY_VERSION } from './pin.ts'
import { SessionProjectionsRecord } from './session-projections.ts'
import { ToolsService, type ToolExec } from './tools-service.ts'
import { digestEqual } from './warnings.ts'

const FIBER_STATE = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading'] as const

export interface InstallResult {
  readonly status: 'active' | 'pending' | 'failed'
  readonly name: string
  readonly version: string
  readonly runtime: 'in-process'
  readonly unmet: readonly string[]
  readonly scriptsExecuted: false
  readonly bundlePatchIgnored: boolean
  readonly message?: string
}

export interface ServiceInfo {
  readonly name: string
  readonly implementation?: string
  readonly chain: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function packageVersion(name: string): string {
  const require = createRequire(import.meta.url)
  const file = require.resolve(`${name}/package.json`)
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!isRecord(parsed) || typeof parsed.version !== 'string') {
    throw new HostError('cordis-pin', `${name} package.json has no version`)
  }
  return parsed.version
}

function assertPins(): { cordis: string; schemastery: string } {
  const cordis = packageVersion(CORDIS_PACKAGE)
  const schemastery = packageVersion(SCHEMASTERY_PACKAGE)
  if (cordis !== CORDIS_VERSION) {
    throw new HostError('cordis-pin', `cordis ${cordis} is not the pinned ${CORDIS_VERSION}`)
  }
  if (schemastery !== SCHEMASTERY_VERSION) {
    throw new HostError('cordis-pin', `schemastery ${schemastery} is not the pinned ${SCHEMASTERY_VERSION}`)
  }
  return { cordis, schemastery }
}

function prototypeChain(value: object): string[] {
  const names: string[] = []
  let ctor: unknown = value.constructor
  while (typeof ctor === 'function' && ctor.name !== '' && ctor.name !== 'Function' && names.length < 8) {
    names.push(ctor.name)
    ctor = Object.getPrototypeOf(ctor) as unknown
  }
  return names
}

function asPlugin(mod: object): unknown {
  const record = mod as Record<string, unknown>
  const candidate = record.default ?? record
  if (typeof candidate === 'function') return candidate
  if (isRecord(candidate) && typeof candidate.apply === 'function') {
    return {
      ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
      ...(candidate.inject !== undefined ? { inject: candidate.inject } : {}),
      ...(candidate.Config !== undefined ? { Config: candidate.Config } : {}),
      apply: candidate.apply,
    }
  }
  throw new HostError('not-a-plugin', 'module has no plugin class or apply function')
}

function unmetInjections(fiber: Fiber): string[] {
  const inject: unknown = fiber.inject
  if (!isRecord(inject)) return []
  return Object.entries(inject).filter(([, value]) => value == null).map(([key]) => key)
}

function requireConfirmation(preview: PackagePreview, confirmation: unknown): void {
  if (!isRecord(confirmation)) {
    throw new HostError('confirmation-required', 'installation requires human confirmation', preview)
  }
  if ('approvedBuilds' in confirmation || 'allowBuilds' in confirmation) {
    throw new HostError('build-approval-refused', 'build scripts are not approved by this host', preview)
  }
  if (confirmation.accept !== true) {
    throw new HostError('confirmation-required', 'installation requires accept: true from a person', preview)
  }
  if (typeof confirmation.digest !== 'string' || !digestEqual(confirmation.digest, preview.digest)) {
    throw new HostError('confirmation-mismatch', 'confirmation digest does not match this package and warning', preview)
  }
  if (preview.scripts.length > 0 && confirmation.scripts !== 'do-not-run') {
    throw new HostError('lifecycle-scripts-not-run', 'lifecycle scripts are never run; confirm with scripts set to do-not-run', preview)
  }
  if (preview.scripts.length === 0 && confirmation.scripts !== undefined && confirmation.scripts !== 'do-not-run') {
    throw new HostError('build-approval-refused', 'this host does not accept build-script approval', preview)
  }
}

export class CordisRuntime {
  readonly context: Context
  readonly cordisVersion: string
  readonly schemasteryVersion: string
  readonly #loaded = new Map<string, InstallResult>()

  private constructor(context: Context, versions: { cordis: string; schemastery: string }) {
    this.context = context
    this.cordisVersion = versions.cordis
    this.schemasteryVersion = versions.schemastery
  }

  static async create(): Promise<CordisRuntime> {
    const versions = assertPins()
    const context = new Context()
    await context.plugin(ToolsService)
    await context.plugin(CommandsService)
    await context.plugin(SessionProjectionsRecord)
    return new CordisRuntime(context, versions)
  }

  preview(packageDir: string): Promise<PackagePreview> {
    return inspectPackage(packageDir)
  }

  async install(packageDir: string, confirmation: unknown, config?: unknown): Promise<InstallResult> {
    const preview = await inspectPackage(packageDir)
    const existing = this.#loaded.get(preview.realpath)
    if (existing !== undefined && existing.status !== 'failed') return existing
    requireConfirmation(preview, confirmation)
    const imported: unknown = await import(pathToFileURL(preview.entry).href)
    if (!isRecord(imported) && typeof imported !== 'function') {
      throw new HostError('not-a-plugin', 'plugin module did not evaluate to an object')
    }
    const plugin = asPlugin(isRecord(imported) ? imported : { default: imported })
    const load = this.context.plugin as unknown as (plugin: unknown, config?: unknown) => Fiber & PromiseLike<Fiber>
    const fiber = config === undefined ? load(plugin) : load(plugin, config)
    try {
      await fiber
    } catch (error) {
      await fiber.dispose().catch(() => undefined)
      const message = error instanceof Error ? error.message : 'plugin failed'
      const result: InstallResult = {
        status: 'failed',
        name: preview.name,
        version: preview.version,
        runtime: 'in-process',
        unmet: [],
        scriptsExecuted: false,
        bundlePatchIgnored: preview.bundlePatchIgnored,
        message,
      }
      this.#loaded.set(preview.realpath, result)
      return result
    }
    const state = FIBER_STATE[fiber.state] ?? 'failed'
    const status = state === 'active' ? 'active' : state === 'pending' ? 'pending' : 'failed'
    const result: InstallResult = {
      status,
      name: preview.name,
      version: preview.version,
      runtime: 'in-process',
      unmet: status === 'pending' ? unmetInjections(fiber) : [],
      scriptsExecuted: false,
      bundlePatchIgnored: preview.bundlePatchIgnored,
      ...(status === 'failed' ? { message: `plugin fiber is ${state}` } : {}),
    }
    this.#loaded.set(preview.realpath, result)
    return result
  }

  plugins(): readonly InstallResult[] {
    return [...this.#loaded.values()]
  }

  services(): ServiceInfo[] {
    const props = this.context.reflect.props as Record<string, { type?: string }>
    const infos: ServiceInfo[] = []
    for (const [name, property] of Object.entries(props)) {
      if (property.type !== 'service') continue
      const value: unknown = this.context.get(name)
      const implementation = isRecord(value) && typeof value.implementation === 'string' ? value.implementation : undefined
      infos.push({
        name,
        ...(implementation === undefined ? {} : { implementation }),
        chain: typeof value === 'object' && value !== null ? prototypeChain(value) : [],
      })
    }
    return infos
  }

  invokeTool(name: string, args: unknown, exec: ToolExec): Promise<unknown> {
    return this.context.tools.invoke(name, args, exec)
  }

  toolUsesSubset(name: string): boolean {
    return this.context.tools.usesSubset(name)
  }

  executeCommand(line: string, signal: AbortSignal) {
    return this.context.commands.execute(line, signal)
  }

  emitEvent(name: string, payload: unknown): void {
    if (!/^[a-z][a-z0-9/_-]{0,80}$/u.test(name) || name.startsWith('internal/')) {
      throw new HostError('bad-request', 'event name is not allowed')
    }
    const emit = this.context.emit as (event: string, payload: unknown) => void
    emit(name, payload)
  }

  sessionProjectionKeys(): readonly string[] {
    return this.context.sessionProjections.keys()
  }

  sessionProjectionApplyCalls(): number {
    return this.context.sessionProjections.applyCalls
  }

  async close(): Promise<void> {
    await this.context.fiber.dispose().catch(() => undefined)
  }
}
