import { Context, Service } from 'cordis'

declare module 'cordis' {
  interface Context {
    sessionProjections: SessionProjectionsRecord
  }
}

interface ProjectionRegistration {
  readonly key?: unknown
  readonly apply?: unknown
}

/**
 * Record-only stand-in for DSH's `sessionProjections` service.
 *
 * tool-todo injects this name and awaits `register` before it calls
 * `ctx.tools.register`. We keep the registration and never call `apply`,
 * because there is no session log to fold. `applyCalls` stays 0 unless a
 * future change starts replaying events.
 */
export class SessionProjectionsRecord extends Service {
  readonly implementation = 'record-only'

  /** Public so Cordis's service proxy can reach it. Private fields throw through that proxy. */
  readonly registrations = new Map<string, ProjectionRegistration>()

  applyCalls = 0

  constructor(ctx: Context) {
    super(ctx, 'sessionProjections')
  }

  async register(definition: ProjectionRegistration): Promise<() => void> {
    const key = definition.key
    if (typeof key !== 'string' || key === '') throw new Error('session projection key is required')
    if (this.registrations.has(key)) throw new Error(`session projection "${key}" is already registered`)
    this.registrations.set(key, definition)
    return () => {
      if (this.registrations.get(key) === definition) this.registrations.delete(key)
    }
  }

  keys(): readonly string[] {
    return [...this.registrations.keys()]
  }
}
