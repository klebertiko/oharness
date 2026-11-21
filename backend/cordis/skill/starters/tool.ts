import type { Context } from 'cordis'

export const name = '__NAME__'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register({
    name: '__TOOL__',
    description: 'Say hello to someone.',
    async execute(args: unknown) {
      const who = typeof args === 'object' && args !== null && 'name' in args && typeof args.name === 'string' ? args.name : 'world'
      return { greeting: `Hello, ${who}.` }
    },
  })
}
