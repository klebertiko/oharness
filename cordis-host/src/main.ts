import { writeSync } from 'node:fs'
import './register-alias.ts'
import { startHost } from './server.ts'

const running = await startHost()
// Synchronous write so a piped parent sees the line without waiting for a buffer flush.
writeSync(1, `${JSON.stringify({
  host: '127.0.0.1',
  port: running.port,
  token: running.token,
  cordis: running.runtime.cordisVersion,
  runtime: 'in-process',
})}\n`)

let closing = false
async function shutdown(): Promise<void> {
  if (closing) return
  closing = true
  await running.close()
  process.exit(0)
}

process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
