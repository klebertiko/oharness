import { randomUUID } from 'node:crypto'
import { Context, Service } from 'cordis'

/**
 * Slash-command split used by DSH's command registry
 * (packages/interaction/commands/src/index.ts, parseCommand). The pattern is
 * fixed. Input is not compiled into a regular expression.
 */
const COMMAND_LINE = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

export interface CommandResult {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

export interface CommandInvocation {
  readonly commandId: string
  readonly rawInput: string
  readonly signal: AbortSignal
  readonly attachments: readonly []
}

interface CommandDefinition {
  readonly name: string
  readonly description?: string
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}

declare module 'cordis' {
  interface Context {
    commands: CommandsService
  }
  interface Events {
    'commands/change'(): void
  }
}

/**
 * In-process command registry. Plugins call `ctx.commands.register` with a
 * name and a handler. There is no agent scope and no session log: DSH writes
 * `command/run` and `command/done` onto a session, and this host does not.
 */
export class CommandsService extends Service {
  readonly implementation = 'oharness-subset'

  /** Public so Cordis's service proxy can reach it. Private fields throw through that proxy. */
  readonly commands = new Map<string, CommandDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'commands')
  }

  register(definition: CommandDefinition): () => void {
    if (!COMMAND_NAME.test(definition.name)) throw new Error('command name must be a lowercase slug')
    if (this.commands.has(definition.name)) {
      throw new Error(`command "${definition.name}" is already registered`)
    }
    if (typeof definition.handler !== 'function') throw new Error(`command "${definition.name}" has no handler`)
    this.commands.set(definition.name, definition)
    this.ctx.emit('commands/change')
    return () => {
      if (this.commands.get(definition.name) === definition) {
        this.commands.delete(definition.name)
        this.ctx.emit('commands/change')
      }
    }
  }

  names(): readonly string[] {
    return [...this.commands.keys()]
  }

  async execute(line: string, signal: AbortSignal): Promise<CommandResult | undefined> {
    const match = COMMAND_LINE.exec(line)
    if (match === null) return undefined
    const name = match[1]
    if (name === undefined) return undefined
    const command = this.commands.get(name)
    if (command === undefined) return undefined
    const result = await command.handler({
      commandId: randomUUID(),
      rawInput: line.slice(match[0].length),
      signal,
      attachments: [],
    })
    if (result === null || typeof result !== 'object') throw new Error('command returned no result')
    if (result.kind !== 'success' && result.kind !== 'error') throw new Error('command returned an unknown result kind')
    return result
  }
}
