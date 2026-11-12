import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { HostError } from './errors.ts'
import { CordisRuntime } from './host.ts'

const BODY_LIMIT = 64 * 1024

export function assertLoopbackBind(address: AddressInfo | string | null): asserts address is AddressInfo {
  if (address === null || typeof address === 'string') {
    throw new HostError('bind', 'host did not bind a TCP port')
  }
  if (address.address !== '127.0.0.1') {
    throw new HostError('bind', 'host must bind 127.0.0.1')
  }
}

function tokensEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b)
}

function redact(text: string, token: string): string {
  if (token === '') return text
  return text.split(token).join('[redacted]')
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return undefined
  return header.slice('Bearer '.length)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buffer.length
    if (size > BODY_LIMIT) throw new HostError('bad-request', 'body is too large')
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  const type = req.headers['content-type']
  if (typeof type !== 'string' || !type.startsWith('application/json')) {
    throw new HostError('bad-request', 'content-type must be application/json')
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HostError('bad-request', 'body is not valid JSON')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}

const STATUS_BY_CODE: Record<string, number> = {
  unauthorized: 401,
  'bad-request': 400,
  'path-rejected': 400,
  'runtime-not-supported': 400,
  'not-a-plugin': 400,
  'build-approval-refused': 400,
  'confirmation-required': 409,
  'confirmation-mismatch': 409,
  'lifecycle-scripts-not-run': 409,
  bind: 500,
  'cordis-pin': 500,
}

function rejectBuildApproval(body: Record<string, unknown>): void {
  if ('approvedBuilds' in body || 'allowBuilds' in body) {
    throw new HostError('build-approval-refused', 'build scripts are not approved by this host')
  }
}

export interface RunningHost {
  readonly port: number
  readonly token: string
  readonly runtime: CordisRuntime
  close(): Promise<void>
}

export async function startHost(): Promise<RunningHost> {
  const runtime = await CordisRuntime.create()
  const token = randomBytes(32).toString('base64url')
  const server = createServer((req, res) => {
    void onRequest(runtime, token, server, req, res)
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  try {
    assertLoopbackBind(address)
  } catch (error) {
    server.close()
    throw error
  }
  server.on('connection', (socket) => {
    if (socket.remoteAddress !== '127.0.0.1') socket.destroy()
  })
  return {
    port: address.port,
    token,
    runtime,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve() })
      })
      await runtime.close()
    },
  }
}

async function onRequest(runtime: CordisRuntime, token: string, server: Server, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.socket.remoteAddress !== '127.0.0.1') {
      send(res, 403, { error: 'forbidden' })
      return
    }
    const address = server.address()
    assertLoopbackBind(address)
    if (req.headers.host !== `127.0.0.1:${String(address.port)}`) {
      send(res, 400, { error: 'host header must be 127.0.0.1 and this port' })
      return
    }
    const presented = bearer(req)
    if (presented === undefined || !tokensEqual(presented, token)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const method = req.method ?? 'GET'
    if (method === 'GET' && url.pathname === '/v1/health') {
      send(res, 200, {
        host: '127.0.0.1',
        port: address.port,
        runtime: 'in-process',
        pid: process.pid,
        cordis: { name: 'cordis', version: runtime.cordisVersion },
        schemastery: { name: 'schemastery', version: runtime.schemasteryVersion },
        tools: 'oharness-subset',
        sessionProjections: 'record-only',
      })
      return
    }
    if (method === 'GET' && url.pathname === '/v1/plugins') {
      send(res, 200, { plugins: runtime.plugins() })
      return
    }
    if (method === 'GET' && url.pathname === '/v1/services') {
      send(res, 200, { services: runtime.services() })
      return
    }
    const body = method === 'GET' ? undefined : await readBody(req)
    if (method === 'POST' && url.pathname === '/v1/plugins/preview') {
      if (!isRecord(body) || typeof body.packageDir !== 'string') {
        throw new HostError('bad-request', 'packageDir is required')
      }
      send(res, 200, await runtime.preview(body.packageDir))
      return
    }
    if (method === 'POST' && url.pathname === '/v1/plugins/install') {
      if (!isRecord(body) || typeof body.packageDir !== 'string') {
        throw new HostError('bad-request', 'packageDir is required')
      }
      rejectBuildApproval(body)
      const result = await runtime.install(body.packageDir, body.confirmation, body.config)
      send(res, result.status === 'failed' ? 422 : 200, result)
      return
    }
    if (method === 'POST' && url.pathname === '/v1/tools/invoke') {
      if (!isRecord(body) || typeof body.name !== 'string') throw new HostError('bad-request', 'tool name is required')
      const controller = new AbortController()
      req.on('close', () => controller.abort())
      try {
        const value: unknown = await runtime.invokeTool(body.name, body.args, {
          callId: randomUUID(),
          signal: controller.signal,
        })
        send(res, 200, { ok: true, value })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'tool failed'
        send(res, 200, { ok: false, error: redact(message, token) })
      }
      return
    }
    if (method === 'POST' && url.pathname === '/v1/commands/execute') {
      if (!isRecord(body) || typeof body.line !== 'string' || body.line.length > 4096) {
        throw new HostError('bad-request', 'line is required')
      }
      const controller = new AbortController()
      req.on('close', () => controller.abort())
      const result = await runtime.executeCommand(body.line, controller.signal)
      send(res, 200, { ok: true, result: result ?? null })
      return
    }
    if (method === 'POST' && url.pathname === '/v1/events/emit') {
      if (!isRecord(body) || typeof body.name !== 'string') throw new HostError('bad-request', 'event name is required')
      runtime.emitEvent(body.name, body.payload)
      send(res, 200, { ok: true, name: body.name })
      return
    }
    send(res, 404, { error: 'not found' })
  } catch (error) {
    if (error instanceof HostError) {
      const status = STATUS_BY_CODE[error.code] ?? 400
      const payload: Record<string, unknown> = { error: redact(error.message, token), code: error.code }
      if (error.preview !== undefined) payload.preview = error.preview
      send(res, status, payload)
      return
    }
    const message = error instanceof Error ? error.message : 'internal'
    console.error(redact(message, token))
    send(res, 500, { error: 'internal' })
  }
}
