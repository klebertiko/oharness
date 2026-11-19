export const SHUTDOWN_TIMEOUT_MS = 5000

export interface ShutdownDeps {
  /** Graceful close: stop listening, dispose plugins, remove snapshots. */
  readonly close: () => Promise<void>
  /** Synchronous last resort: kill plugin processes and remove snapshots. */
  readonly abandon: () => void
  readonly exit: (code: number) => void
  readonly timeoutMs?: number
}

/**
 * Build the host's shutdown. It runs once. A plugin whose dispose never
 * settles must not keep the host alive, and must not leave its snapshot in
 * the temp folder either: on timeout, `abandon` runs before exit 1.
 */
export function createShutdown(deps: ShutdownDeps): () => Promise<void> {
  let started: Promise<void> | undefined
  return () => {
    started ??= new Promise<void>((resolve) => {
      let finished = false
      const finish = (code: number): void => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (code !== 0) deps.abandon()
        deps.exit(code)
        resolve()
      }
      // Kept referenced on purpose: a dispose stuck on a promise that holds no
      // handle would otherwise let the loop drain and exit 0, skipping abandon.
      const timer = setTimeout(() => { finish(1) }, deps.timeoutMs ?? SHUTDOWN_TIMEOUT_MS)
      deps.close().then(() => { finish(0) }, () => { finish(1) })
    })
    return started
  }
}
