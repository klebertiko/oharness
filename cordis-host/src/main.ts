import { writeSync } from 'node:fs'
import './register-alias.ts'
import { startHost } from './server.ts'
import { createShutdown } from './shutdown.ts'

const running = await startHost()
// Synchronous write so a piped parent sees the line without waiting for a buffer flush.
writeSync(1, `${JSON.stringify({
  host: '127.0.0.1',
  port: running.port,
  token: running.token,
  cordis: running.runtime.cordisVersion,
  runtime: 'isolated',
})}\n`)

const shutdown = createShutdown({
  close: () => running.close(),
  abandon: () => { running.runtime.abandon() },
  exit: (code) => { process.exit(code) },
})

// npm start runs with --disable-sigusr1, so SIGUSR1 never opens the inspector.
// Without a listener its default action would end the host; ignore it instead.
process.on('SIGUSR1', () => undefined)
process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
// The parent (sidecar or app) holds our stdin. If it dies, even without
// sending a signal, the pipe closes and the host must not keep listening.
process.stdin.on('end', () => { void shutdown() })
process.stdin.on('close', () => { void shutdown() })
process.stdin.resume()
