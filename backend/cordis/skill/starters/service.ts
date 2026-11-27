import { Context, Service } from 'cordis'

/** A service lives in this plugin's own process; this plugin's tools and commands can use it. */
class Counter extends Service {
  private count = 0

  constructor(ctx: Context) {
    super(ctx, '__SERVICE__')
  }

  next(): number {
    this.count += 1
    return this.count
  }
}

export const name = '__NAME__'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.plugin(Counter)
  ctx.tools.register({
    name: '__TOOL__',
    description: 'Count how many times it was called.',
    async execute() {
      const counter = ctx.get('__SERVICE__') as Counter | undefined
      return { count: counter ? counter.next() : 0 }
    },
  })
}
