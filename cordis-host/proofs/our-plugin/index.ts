import { Context, Service } from 'cordis'

const seen: unknown[] = []

class ProofMark extends Service {
  readonly pid = process.pid

  constructor(ctx: Context) {
    super(ctx, 'proofMark')
  }
}

export const name = 'oharness-proof'
export const inject = ['tools', 'commands']

function textOf(args: unknown): string {
  if (typeof args !== 'object' || args === null || !('text' in args) || typeof args.text !== 'string') {
    throw new Error('text is required')
  }
  return args.text
}

export function apply(ctx: Context): void {
  const mark = globalThis as typeof globalThis & { oharnessProofPluginEvaluated?: number }
  mark.oharnessProofPluginEvaluated = (mark.oharnessProofPluginEvaluated ?? 0) + 1
  ctx.plugin(ProofMark)
  const on = ctx.on as (name: string, listener: (payload: unknown) => void) => () => boolean
  on('proof/ping', (payload) => { seen.push(payload) })
  ctx.tools.register({
    name: 'proof_echo',
    description: 'Echo one string.',
    async execute(args: unknown) {
      return { echoed: textOf(args), pid: process.pid }
    },
  })
  ctx.tools.register({
    name: 'proof_seen',
    description: 'Events this plugin heard.',
    async execute() {
      return { events: seen, pid: process.pid }
    },
  })
  ctx.commands.register({
    name: 'proof',
    description: 'Report the proof.',
    async handler(invocation) {
      return { kind: 'success' as const, text: `proof ${invocation.rawInput.trim()} pid ${String(process.pid)}` }
    },
  })
}
