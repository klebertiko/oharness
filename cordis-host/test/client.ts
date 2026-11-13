import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHost, type RunningHost } from '../src/server.ts'

export const packageRoot = fileURLToPath(new URL('..', import.meta.url))
export const ourPluginDir = fileURLToPath(new URL('../proofs/our-plugin/', import.meta.url))
export const directoryPickerDir = fileURLToPath(new URL('../proofs/dsh-directory-picker/', import.meta.url))
export const toolTodoDir = fileURLToPath(new URL('../vendor/dsh/tool-todo/', import.meta.url))
export const directoryPickerSource = fileURLToPath(new URL('../vendor/dsh/directory-picker/index.ts', import.meta.url))

export function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  assert.equal(Array.isArray(value), false)
  return value as Record<string, unknown>
}

export async function withHost(run: (host: RunningHost) => Promise<void>): Promise<void> {
  const host = await startHost()
  try {
    await run(host)
  } finally {
    await host.close()
  }
}

export async function call(
  host: RunningHost,
  pathname: string,
  init?: { method?: string; body?: unknown; token?: string | null; hostHeader?: string },
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {}
  if (init?.token !== null) headers.authorization = `Bearer ${init?.token ?? host.token}`
  if (init?.hostHeader !== undefined) headers.host = init.hostHeader
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  const method = init?.method ?? (init?.body === undefined ? 'GET' : 'POST')
  const payload = init?.body === undefined ? undefined : JSON.stringify(init.body)
  const response = await fetch(`http://127.0.0.1:${String(host.port)}${pathname}`, { method, headers, body: payload })
  const text = await response.text()
  return { status: response.status, json: text === '' ? null : JSON.parse(text) as unknown }
}

export async function preview(host: RunningHost, packageDir: string): Promise<Record<string, unknown>> {
  const response = await call(host, '/v1/plugins/preview', { body: { packageDir } })
  assert.equal(response.status, 200)
  return asRecord(response.json)
}

export async function installConfirmed(
  host: RunningHost,
  packageDir: string,
  config?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const seen = await preview(host, packageDir)
  const scripts = seen.scripts
  assert.ok(Array.isArray(scripts))
  const confirmation: Record<string, unknown> = { accept: true, digest: seen.digest }
  if (scripts.length > 0) confirmation.scripts = 'do-not-run'
  const response = await call(host, '/v1/plugins/install', { body: { packageDir, confirmation, config } })
  return { status: response.status, json: asRecord(response.json) }
}

export async function tempPackage(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cordis-host-'))
  await mkdir(dir, { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(dir, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, contents)
  }
  return dir
}

export function httpGet(port: number, pathname: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    req.end()
  })
}
