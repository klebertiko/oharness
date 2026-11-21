import { readFileSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Context, Fiber } from 'cordis'
import { COMMAND_LINE } from './commands-service.ts'
import { HostError } from './errors.ts'
import { IsolatedPlugin } from './isolated-plugin.ts'
import { inspectPackage, snapshotPackage, type Capability, type PackagePreview, type Runtime } from './manifest.ts'
import { CORDIS_PACKAGE, CORDIS_VERSION, SCHEMASTERY_PACKAGE, SCHEMASTERY_VERSION } from './pin.ts'
import { asPlugin, hostContext, isRecord, listServices, loadPlugin, type ServiceInfo } from './plugin-load.ts'
import { confineSnapshot, OutsidePackageError, releaseSnapshot } from './register-alias.ts'
import type { ToolExec } from './tools-service.ts'
import { digestEqual } from './warnings.ts'

export type { ServiceInfo } from './plugin-load.ts'

export interface InstallResult {
  readonly status: 'active' | 'pending' | 'failed'
  readonly name: string
  readonly version: string
  readonly runtime: Runtime
  readonly unmet: readonly string[]
  readonly scriptsExecuted: false
  readonly bundlePatchIgnored: boolean
  readonly message?: string
}

interface Loaded {
  readonly tree: string
  readonly result: InstallResult
  readonly isolated?: IsolatedPlugin
  /** In-process plugin: its Cordis fiber, disposed on unload. */
  readonly fiber?: Fiber
  /** Folder of the private copy this plugin runs from. */
  readonly snapshot: string
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

export interface RuntimeOptions {
  readonly pluginRoots: readonly string[]
  /** Longest a tool call or command may take in an isolated plugin. */
  readonly callTimeoutMs?: number
}

export class CordisRuntime {
  readonly context: Context
  readonly cordisVersion: string
  readonly schemasteryVersion: string
  readonly pluginRoots: readonly string[]
  readonly #callTimeoutMs: number | undefined
  readonly #loaded = new Map<string, Loaded>()
  readonly #snapshots: string[] = []

  private constructor(context: Context, versions: { cordis: string; schemastery: string }, options: RuntimeOptions) {
    this.context = context
    this.pluginRoots = [...options.pluginRoots]
    this.#callTimeoutMs = options.callTimeoutMs
    this.cordisVersion = versions.cordis
    this.schemasteryVersion = versions.schemastery
  }

  static async create(options: RuntimeOptions): Promise<CordisRuntime> {
    const versions = assertPins()
    return new CordisRuntime(await hostContext(), versions, options)
  }

  preview(packageDir: string): Promise<PackagePreview> {
    return inspectPackage(packageDir, this.pluginRoots)
  }

  #isolated(): IsolatedPlugin[] {
    const found: IsolatedPlugin[] = []
    for (const loaded of this.#loaded.values()) if (loaded.isolated?.running === true) found.push(loaded.isolated)
    return found
  }

  async install(packageDir: string, confirmation: unknown, config?: unknown): Promise<InstallResult> {
    // Re-read and re-hash the package here, right before the import: the
    // digest the person confirmed must match the bytes that are about to run.
    const preview = await inspectPackage(packageDir, this.pluginRoots)
    const existing = this.#loaded.get(preview.realpath)
    // A package that is still running answers with its result, but only when
    // its files are the ones that were loaded; changed files need a new confirmation.
    if (existing !== undefined && existing.tree === preview.tree && this.#statusOf(existing) !== 'failed') {
      return this.#resultOf(existing)
    }
    if (existing !== undefined && this.#statusOf(existing) !== 'failed') {
      throw new HostError('confirmation-mismatch', 'a different version of this package is already loaded; restart the host to replace it', preview)
    }
    requireConfirmation(preview, confirmation)
    const snapshot = await snapshotPackage(preview)
    this.#snapshots.push(snapshot.dir)
    const loaded = preview.runtime === 'isolated'
      ? await this.#installIsolated(preview, snapshot, config)
      : await this.#installInProcess(preview, snapshot, config)
    this.#loaded.set(preview.realpath, loaded)
    return this.#resultOf(loaded)
  }

  async #installInProcess(preview: PackagePreview, snapshot: { dir: string; entry: string }, config: unknown): Promise<Loaded> {
    confineSnapshot(snapshot.dir)
    let imported: unknown
    try {
      imported = await import(pathToFileURL(snapshot.entry).href)
    } catch (error) {
      if (error instanceof OutsidePackageError) throw new HostError('path-rejected', error.message, preview)
      throw error
    }
    const outcome = await loadPlugin(this.context, asPlugin(imported), config)
    return {
      tree: preview.tree,
      snapshot: snapshot.dir,
      result: this.#result(preview, outcome.status, outcome.unmet, outcome.message),
      ...(outcome.fiber === undefined ? {} : { fiber: outcome.fiber }),
    }
  }

  async #installIsolated(preview: PackagePreview, snapshot: { dir: string; entry: string }, config: unknown): Promise<Loaded> {
    const plugin = await IsolatedPlugin.start({
      name: preview.name,
      entry: snapshot.entry,
      snapshot: snapshot.dir,
      capabilities: preview.capabilities as Capability[],
      ...(config === undefined ? {} : { config }),
      ...(this.#callTimeoutMs === undefined ? {} : { callTimeoutMs: this.#callTimeoutMs }),
    })
    if (plugin.code !== undefined) {
      await plugin.stop()
      throw new HostError(plugin.code, plugin.message ?? 'plugin was refused', preview)
    }
    const taken = new Set([...this.context.tools.names(), ...this.#isolated().flatMap((other) => other.tools)])
    const takenCommands = new Set([...this.context.commands.names(), ...this.#isolated().flatMap((other) => other.commands)])
    const clash = plugin.tools.find((name) => taken.has(name)) ?? plugin.commands.find((name) => takenCommands.has(name))
    if (clash !== undefined) {
      await plugin.stop()
      return { tree: preview.tree, snapshot: snapshot.dir, result: this.#result(preview, 'failed', [], `"${clash}" is already registered by another plugin`) }
    }
    return { tree: preview.tree, snapshot: snapshot.dir, result: this.#result(preview, 'active', [], undefined), isolated: plugin }
  }

  #result(preview: PackagePreview, status: InstallResult['status'], unmet: readonly string[], message: string | undefined): InstallResult {
    return {
      status,
      name: preview.name,
      version: preview.version,
      runtime: preview.runtime,
      unmet,
      scriptsExecuted: false,
      bundlePatchIgnored: preview.bundlePatchIgnored,
      ...(message === undefined ? {} : { message }),
    }
  }

  #statusOf(loaded: Loaded): InstallResult['status'] {
    const isolated = loaded.isolated
    if (isolated === undefined) return loaded.result.status
    return isolated.status === 'active' || isolated.status === 'pending' ? isolated.status : 'failed'
  }

  #resultOf(loaded: Loaded): InstallResult {
    const isolated = loaded.isolated
    if (isolated === undefined) return loaded.result
    const status = this.#statusOf(loaded)
    const message = status === 'failed' ? isolated.message ?? 'plugin failed' : isolated.message
    const { message: _drop, ...rest } = loaded.result
    return { ...rest, status, unmet: isolated.unmet, ...(message === undefined ? {} : { message }) }
  }

  plugins(): readonly InstallResult[] {
    return [...this.#loaded.values()].map((loaded) => this.#resultOf(loaded))
  }

  services(): ServiceInfo[] {
    const rows = listServices(this.context)
    for (const loaded of this.#loaded.values()) {
      if (loaded.isolated?.running !== true) continue
      for (const row of loaded.isolated.services) rows.push({ ...row, plugin: loaded.result.name })
    }
    return rows
  }

  #toolOwner(name: string): IsolatedPlugin | undefined {
    return this.#isolated().find((plugin) => plugin.tools.includes(name))
  }

  invokeTool(name: string, args: unknown, exec: ToolExec): Promise<unknown> {
    const owner = this.#toolOwner(name)
    if (owner !== undefined) return owner.invoke(name, args, exec.agent, exec.signal)
    return this.context.tools.invoke(name, args, exec)
  }

  toolUsesSubset(name: string): boolean {
    const owner = this.#toolOwner(name)
    if (owner !== undefined) return owner.subsetTools.includes(name)
    return this.context.tools.usesSubset(name)
  }

  async executeCommand(line: string, signal: AbortSignal): Promise<unknown> {
    const command = COMMAND_LINE.exec(line)?.[1]
    const owner = command === undefined ? undefined : this.#isolated().find((plugin) => plugin.commands.includes(command))
    if (owner !== undefined) return owner.command(line, signal)
    return this.context.commands.execute(line, signal)
  }

  emitEvent(name: string, payload: unknown): void {
    if (!/^[a-z][a-z0-9/_-]{0,80}$/u.test(name) || name.startsWith('internal/')) {
      throw new HostError('bad-request', 'event name is not allowed')
    }
    const emit = this.context.emit as (event: string, payload: unknown) => void
    emit(name, payload)
    for (const plugin of this.#isolated()) plugin.emit(name, payload)
  }

  sessionProjectionKeys(): readonly string[] {
    return [...this.context.sessionProjections.keys(), ...this.#isolated().flatMap((plugin) => plugin.projections)]
  }

  /** Always 0 for isolated plugins: their record-only service never replays either. */
  sessionProjectionApplyCalls(): number {
    return this.context.sessionProjections.applyCalls
  }

  /**
   * Stop a plugin by its package name and forget it: an isolated plugin's
   * process is stopped, an in-process plugin's fiber is disposed, and its
   * private copy is deleted. Another version can be installed afterwards.
   */
  async unload(name: string): Promise<void> {
    const keys = [...this.#loaded.entries()].filter(([, loaded]) => loaded.result.name === name).map(([key]) => key)
    if (keys.length === 0) throw new HostError('plugin-not-found', `no plugin named ${name} is loaded`)
    for (const key of keys) {
      const loaded = this.#loaded.get(key)
      if (loaded === undefined) continue
      this.#loaded.delete(key)
      if (loaded.isolated !== undefined) await loaded.isolated.stop()
      if (loaded.fiber !== undefined) await loaded.fiber.dispose().catch(() => undefined)
      releaseSnapshot(loaded.snapshot)
      const at = this.#snapshots.indexOf(loaded.snapshot)
      if (at >= 0) this.#snapshots.splice(at, 1)
      await rm(loaded.snapshot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Folders this runtime created for snapshots. */
  snapshotDirs(): readonly string[] {
    return [...this.#snapshots]
  }

  async close(): Promise<void> {
    await Promise.all([...this.#loaded.values()].map((loaded) => loaded.isolated?.stop()))
    await this.context.fiber.dispose().catch(() => undefined)
    for (const dir of this.#snapshots) releaseSnapshot(dir)
    await Promise.all(this.#snapshots.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)))
  }

  /**
   * Last resort for a host that must exit now (a dispose that never settles):
   * kill plugin processes and delete snapshot folders synchronously, so
   * nothing is left behind in the temp folder.
   */
  abandon(): void {
    for (const loaded of this.#loaded.values()) loaded.isolated?.killNow()
    for (const dir of this.#snapshots) {
      releaseSnapshot(dir)
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort on exit */ }
    }
  }
}
