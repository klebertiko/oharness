import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { assertLoopbackBind } from '../src/server.ts'
import { asRecord, call, httpGet, installConfirmed, packageRoot, preview, tempPackage, withHost } from './client.ts'

test('bind helper rejects anything except 127.0.0.1', () => {
  assert.throws(() => assertLoopbackBind(null), /TCP port/)
  assert.throws(() => assertLoopbackBind({ address: '0.0.0.0', family: 'IPv4', port: 1 }), /127\.0\.0\.1/)
  assert.doesNotThrow(() => assertLoopbackBind({ address: '127.0.0.1', family: 'IPv4', port: 9 }))
})

test('the listener is loopback, the token is required, and the query string is not a credential', async () => {
  await withHost(async (host) => {
    assert.notEqual(host.port, 0)
    assert.ok(host.port > 1024)
    const health = await call(host, '/v1/health')
    assert.equal(health.status, 200)
    const body = asRecord(health.json)
    assert.equal(body.host, '127.0.0.1')
    assert.equal(body.port, host.port)
    assert.equal(body.runtime, 'in-process')
    assert.equal(body.pid, process.pid)
    assert.equal(JSON.stringify(body).includes(host.token), false)
    assert.equal((await call(host, '/v1/health', { token: null })).status, 401)
    assert.equal((await call(host, '/v1/health', { token: 'wrong-token' })).status, 401)
    const query = await httpGet(host.port, `/?token=${encodeURIComponent(host.token)}`, { host: `127.0.0.1:${String(host.port)}` })
    assert.equal(query.status, 401)
    const foreignHost = await httpGet(host.port, '/v1/health', {
      host: 'evil.invalid',
      authorization: `Bearer ${host.token}`,
    })
    assert.equal(foreignHost.status, 400)
  })
})

test('an environment port does not move the listener', async () => {
  const previous = process.env.PORT
  process.env.PORT = '1'
  try {
    await withHost(async (host) => {
      assert.notEqual(host.port, 1)
    })
  } finally {
    if (previous === undefined) delete process.env.PORT
    else process.env.PORT = previous
  }
})

test('installation does not import the plugin until the human confirms the warning', async () => {
  await withHost(async (host) => {
    const marked = globalThis as typeof globalThis & { oharnessProofPluginEvaluated?: number }
    delete marked.oharnessProofPluginEvaluated
    const dir = await tempPackage({
      'package.json': JSON.stringify({
        name: 'needs-confirmation',
        version: '1.0.0',
        type: 'module',
        main: './index.ts',
      }),
      'index.ts': [
        'const mark = globalThis as { oharnessProofPluginEvaluated?: number }',
        'mark.oharnessProofPluginEvaluated = (mark.oharnessProofPluginEvaluated ?? 0) + 1',
        'export function apply() {}',
        '',
      ].join('\n'),
    })
    const seen = await preview(host, dir)
    const warning = asRecord(seen.warning)
    assert.match(String(warning.en), /files/)
    assert.match(String(warning.en), /network/)
    assert.match(String(warning.en), /processes/)
    assert.match(String(warning.en), /credentials/)
    assert.match(String(warning.en), /agent's actions/)
    assert.match(String(warning.en), /plugin's own code/)
    assert.match(String(warning.en), /not a sandbox/)
    assert.match(String(warning['pt-BR']), /arquivos/)
    assert.match(String(warning['pt-BR']), /credenciais/)
    assert.match(String(warning['pt-BR']), /ações do agente/)
    assert.match(String(warning['pt-BR']), /código do próprio plugin/)
    const missing = await call(host, '/v1/plugins/install', { body: { packageDir: dir } })
    assert.equal(missing.status, 409)
    assert.equal(asRecord(missing.json).code, 'confirmation-required')
    assert.equal(marked.oharnessProofPluginEvaluated, undefined)
    const wrong = await call(host, '/v1/plugins/install', {
      body: { packageDir: dir, confirmation: { accept: true, digest: '0'.repeat(64) } },
    })
    assert.equal(wrong.status, 409)
    assert.equal(asRecord(wrong.json).code, 'confirmation-mismatch')
    assert.equal(marked.oharnessProofPluginEvaluated, undefined)
    const installed = await installConfirmed(host, dir)
    assert.equal(installed.status, 200)
    assert.equal(installed.json.status, 'active')
    assert.equal(installed.json.scriptsExecuted, false)
    assert.equal(installed.json.runtime, 'in-process')
    assert.equal(marked.oharnessProofPluginEvaluated, 1)
  })
})

test('isolated runtime is refused and build approval cannot load a plugin', async () => {
  await withHost(async (host) => {
    const marked = globalThis as typeof globalThis & { oharnessIsolatedEvaluated?: number }
    delete marked.oharnessIsolatedEvaluated
    const dir = await tempPackage({
      'package.json': JSON.stringify({
        name: 'isolated-plugin',
        version: '1.0.0',
        type: 'module',
        main: './index.ts',
        oharness: { runtime: 'isolated' },
      }),
      'index.ts': [
        'const mark = globalThis as { oharnessIsolatedEvaluated?: number }',
        'mark.oharnessIsolatedEvaluated = 1',
        'export function apply() {}',
        '',
      ].join('\n'),
    })
    const refused = await call(host, '/v1/plugins/install', {
      body: { packageDir: dir, confirmation: { accept: true, digest: 'abc' }, approvedBuilds: ['some-package'] },
    })
    assert.equal(refused.status, 400)
    assert.equal(asRecord(refused.json).code, 'build-approval-refused')
    const runtime = await call(host, '/v1/plugins/preview', { body: { packageDir: dir } })
    assert.equal(runtime.status, 400)
    assert.equal(asRecord(runtime.json).code, 'runtime-not-supported')
    assert.equal(marked.oharnessIsolatedEvaluated, undefined)
  })
})

test('lifecycle scripts are never executed', async () => {
  await withHost(async (host) => {
    const dir = await tempPackage({
      'package.json': JSON.stringify({
        name: 'has-install-script',
        version: '1.0.0',
        type: 'module',
        main: './index.ts',
        scripts: { install: 'node mark.js' },
      }),
      'mark.js': 'import { writeFileSync } from "node:fs"\nwriteFileSync(new URL("./ran.txt", import.meta.url), "ran")\n',
      'index.ts': 'export function apply() {}\n',
    })
    const seen = await preview(host, dir)
    assert.deepEqual(seen.scripts, ['install'])
    const allowed = await call(host, '/v1/plugins/install', {
      body: { packageDir: dir, confirmation: { accept: true, digest: seen.digest, scripts: 'allow' } },
    })
    assert.equal(allowed.status, 409)
    assert.equal(asRecord(allowed.json).code, 'lifecycle-scripts-not-run')
    const installed = await installConfirmed(host, dir)
    assert.equal(installed.status, 200)
    assert.equal(installed.json.scriptsExecuted, false)
    await assert.rejects(access(`${dir}/ran.txt`))
  })
})

test('an entry path outside the package is refused before import', async () => {
  await withHost(async (host) => {
    const marked = globalThis as typeof globalThis & { oharnessEscapedEvaluated?: number }
    delete marked.oharnessEscapedEvaluated
    const dir = await tempPackage({
      'package.json': JSON.stringify({
        name: 'escapes',
        version: '1.0.0',
        type: 'module',
        main: '../outside.ts',
      }),
      'index.ts': 'export function apply() {}\n',
    })
    const outside = `${dir}/../outside.ts`
    const { writeFile } = await import('node:fs/promises')
    await writeFile(outside, 'const mark = globalThis as { oharnessEscapedEvaluated?: number }\nmark.oharnessEscapedEvaluated = 1\nexport function apply() {}\n')
    const refused = await call(host, '/v1/plugins/preview', { body: { packageDir: dir } })
    assert.equal(refused.status, 400)
    assert.equal(asRecord(refused.json).code, 'path-rejected')
    assert.equal(marked.oharnessEscapedEvaluated, undefined)
    const relative = await call(host, '/v1/plugins/preview', { body: { packageDir: 'proofs/our-plugin' } })
    assert.equal(relative.status, 400)
  })
})

test('the process entry prints one loopback line and does not repeat the token on stderr', async () => {
  const child = spawn(process.execPath, ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', '--import', './src/register-alias.ts', './src/main.ts'], {
    cwd: packageRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { stdout += chunk })
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  const line = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('host did not print its listener')), 8000)
    child.stdout.on('data', () => {
      const newline = stdout.indexOf('\n')
      if (newline >= 0) {
        clearTimeout(timer)
        resolve(stdout.slice(0, newline))
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`host exited ${String(code)} before it was ready: ${stderr}`))
    })
  })
  try {
    const printed = asRecord(JSON.parse(line) as unknown)
    assert.equal(printed.host, '127.0.0.1')
    assert.equal(printed.runtime, 'in-process')
    assert.equal(typeof printed.token, 'string')
    assert.equal(stderr.includes(String(printed.token)), false)
    const health = await fetch(`http://127.0.0.1:${String(printed.port)}/v1/health`, {
      headers: { authorization: `Bearer ${String(printed.token)}` },
    })
    assert.equal(health.status, 200)
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))
  }
})

test('a package.json directory is rejected without reading a different file', async () => {
  await withHost(async (host) => {
    const dir = await tempPackage({ 'index.ts': 'export function apply() {}\n' })
    await mkdir(path.join(dir, 'package.json'))
    const refused = await call(host, '/v1/plugins/preview', { body: { packageDir: dir } })
    assert.equal(refused.status, 400)
    assert.equal(asRecord(refused.json).code, 'path-rejected')
  })
})
