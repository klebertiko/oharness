/**
 * Subset of `@deepseek-ai/dsh-tools` `defineTool`.
 *
 * DSH's defineTool compiles the parameter spec to JSON Schema and rejects
 * invalid arguments before the tool body runs. This function does not. It
 * checks that a definition has a name, an execute function, and output.render,
 * then returns that definition with a marker. The marker is how a proof tells
 * this subset from the DSH pipeline, which is not installed.
 */
export const toolSubset = Symbol.for('oharness.dsh-tools-subset')

export interface SubsetTool {
  readonly name: string
  readonly description?: string
  readonly parameters?: unknown
  readonly output?: { readonly render?: (args: unknown, value: unknown) => unknown }
  execute(args: unknown, exec: unknown): unknown
  readonly [toolSubset]: true
}

interface DefineToolInput {
  readonly name?: unknown
  readonly description?: unknown
  readonly parameters?: unknown
  readonly output?: { readonly render?: unknown }
  readonly execute?: unknown
  readonly presentCall?: unknown
}

export function defineTool(options: DefineToolInput): SubsetTool {
  const name = typeof options.name === 'string' ? options.name : ''
  if (name === '') throw new Error('defineTool: name is required')
  if (typeof options.execute !== 'function') throw new Error(`defineTool(${name}): execute is required`)
  if (typeof options.output?.render !== 'function') {
    throw new Error(`defineTool(${name}): output.render is required`)
  }
  const execute = options.execute as (args: unknown, exec: unknown) => unknown
  return {
    name,
    ...(typeof options.description === 'string' ? { description: options.description } : {}),
    parameters: options.parameters,
    output: { render: options.output.render as (args: unknown, value: unknown) => unknown },
    ...(typeof options.presentCall === 'function' ? { presentCall: options.presentCall } : {}),
    execute(args: unknown, exec: unknown): unknown {
      return execute(args, exec)
    },
    [toolSubset]: true,
  }
}
