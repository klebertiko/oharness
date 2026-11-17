import { Context, Service } from 'cordis'
import { toolSubset, type SubsetTool } from './dsh-tools-subset.ts'

/** Name DSH reserves for its program transport. Plugins cannot register it. */
const RESERVED_TOOL = 'run_code'

export interface ToolExec {
  readonly callId: string
  readonly signal: AbortSignal
  readonly agent?: unknown
}

interface RegisteredTool {
  readonly name: string
  readonly description?: string
  execute(args: unknown, exec: unknown): unknown
}

declare module 'cordis' {
  interface Context {
    tools: ToolsService
  }
}

/**
 * In-process tool registry. This is the server-side `tools` service a plugin
 * injects. It is not DSH's ToolsService: there is no system prompt, no scope
 * layer, no guard pipeline, and no argument schema check.
 */
export class ToolsService extends Service {
  readonly implementation = 'oharness-subset'

  /** Public so Cordis's service proxy can reach it. Private fields throw through that proxy. */
  readonly tools = new Map<string, RegisteredTool>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(definition: RegisteredTool): () => void {
    const name = definition.name
    if (typeof name !== 'string' || name === '') throw new Error('tool name is required')
    if (name === RESERVED_TOOL) throw new Error(`tool name "${RESERVED_TOOL}" is reserved`)
    if (this.tools.has(name)) throw new Error(`tool "${name}" is already registered`)
    if (typeof definition.execute !== 'function') throw new Error(`tool "${name}" has no execute function`)
    this.tools.set(name, definition)
    return () => {
      if (this.tools.get(name) === definition) this.tools.delete(name)
    }
  }

  names(): readonly string[] {
    return [...this.tools.keys()]
  }

  usesSubset(name: string): boolean {
    const tool = this.tools.get(name)
    return tool !== undefined && toolSubset in tool && tool[toolSubset] === true
  }

  async invoke(name: string, args: unknown, exec: ToolExec): Promise<unknown> {
    const tool = this.tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" is not registered`)
    return await tool.execute(args, exec)
  }
}

export function isSubsetTool(value: unknown): value is SubsetTool {
  return typeof value === 'object' && value !== null && toolSubset in value
}
