import { Context, type Fiber } from 'cordis'
import { CommandsService } from './commands-service.ts'
import { HostError } from './errors.ts'
import { SessionProjectionsRecord } from './session-projections.ts'
import { ToolsService } from './tools-service.ts'

/** Cordis fiber states, by the numeric `fiber.state`. */
export const FIBER_STATE = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading'] as const

/** Services every Cordis context of this host starts with. */
export const BASE_SERVICES: readonly string[] = ['tools', 'commands', 'sessionProjections']

export interface ServiceInfo {
  readonly name: string
  readonly implementation?: string
  readonly chain: readonly string[]
  /** Set for a service that lives in an isolated plugin process. */
  readonly plugin?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A Cordis context with the host's server-side services. */
export async function hostContext(): Promise<Context> {
  const context = new Context()
  await context.plugin(ToolsService)
  await context.plugin(CommandsService)
  await context.plugin(SessionProjectionsRecord)
  return context
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

export function listServices(context: Context): ServiceInfo[] {
  const props = context.reflect.props as Record<string, { type?: string }>
  const infos: ServiceInfo[] = []
  for (const [name, property] of Object.entries(props)) {
    if (property.type !== 'service') continue
    const value: unknown = context.get(name)
    const implementation = isRecord(value) && typeof value.implementation === 'string' ? value.implementation : undefined
    infos.push({
      name,
      ...(implementation === undefined ? {} : { implementation }),
      chain: typeof value === 'object' && value !== null ? prototypeChain(value) : [],
    })
  }
  return infos
}

export function asPlugin(mod: unknown): unknown {
  const record = (typeof mod === 'function' ? { default: mod } : mod) as Record<string, unknown>
  if (!isRecord(record) && typeof mod !== 'function') {
    throw new HostError('not-a-plugin', 'plugin module did not evaluate to an object')
  }
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

export interface LoadOutcome {
  readonly status: 'active' | 'pending' | 'failed'
  readonly unmet: readonly string[]
  readonly message?: string
  /** The live fiber, so the host can dispose it on unload. */
  readonly fiber?: Fiber
}

/** Load an evaluated plugin module into `context` and report the fiber's state. */
export async function loadPlugin(context: Context, plugin: unknown, config?: unknown): Promise<LoadOutcome> {
  const load = context.plugin as unknown as (plugin: unknown, config?: unknown) => Fiber & PromiseLike<Fiber>
  const fiber = config === undefined ? load(plugin) : load(plugin, config)
  try {
    await fiber
  } catch (error) {
    await fiber.dispose().catch(() => undefined)
    return { status: 'failed', unmet: [], message: error instanceof Error ? error.message : 'plugin failed' }
  }
  const state = FIBER_STATE[fiber.state] ?? 'failed'
  const status = state === 'active' ? 'active' : state === 'pending' ? 'pending' : 'failed'
  return {
    status,
    unmet: status === 'pending' ? unmetInjections(fiber) : [],
    ...(status === 'failed' ? { message: `plugin fiber is ${state}` } : {}),
    fiber,
  }
}
