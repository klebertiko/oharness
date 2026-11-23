import type { Context } from 'cordis'

export const name = '__NAME__'
export const inject = ['commands']

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: '__TOOL__',
    description: 'Repeat what follows the command.',
    async handler(invocation: { rawInput: string }) {
      return { kind: 'success' as const, text: invocation.rawInput.trim() || 'Nothing to repeat.' }
    },
  })
}
