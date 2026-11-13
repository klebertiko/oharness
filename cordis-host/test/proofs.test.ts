import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  asRecord,
  call,
  directoryPickerDir,
  directoryPickerSource,
  installConfirmed,
  ourPluginDir,
  preview,
  toolTodoDir,
  withHost,
} from './client.ts'

test('proof 1: our plugin stays unloaded until confirmation, then tools, commands, events, and a service run in this process', async () => {
  await withHost(async (host) => {
    const marked = globalThis as typeof globalThis & { oharnessProofPluginEvaluated?: number }
    delete marked.oharnessProofPluginEvaluated
    const seen = await preview(host, ourPluginDir)
    assert.equal(seen.runtime, 'in-process')
    assert.equal(seen.runtimeDefaulted, false)
    assert.equal(seen.capabilitiesDeclared, true)
    assert.deepEqual(seen.capabilities, [])
    const early = await call(host, '/v1/plugins/install', { body: { packageDir: ourPluginDir } })
    assert.equal(early.status, 409)
    assert.equal(marked.oharnessProofPluginEvaluated, undefined)
    const installed = await installConfirmed(host, ourPluginDir)
    assert.equal(installed.status, 200)
    assert.equal(installed.json.status, 'active')
    assert.equal(installed.json.runtime, 'in-process')
    assert.equal(installed.json.scriptsExecuted, false)
    assert.equal(marked.oharnessProofPluginEvaluated, 1)
    const again = await installConfirmed(host, ourPluginDir)
    assert.equal(again.json.status, 'active')
    assert.equal(marked.oharnessProofPluginEvaluated, 1)

    const echo = await call(host, '/v1/tools/invoke', { body: { name: 'proof_echo', args: { text: 'nilo-host' } } })
    assert.equal(echo.status, 200)
    const echoBody = asRecord(echo.json)
    assert.equal(echoBody.ok, true)
    const echoValue = asRecord(echoBody.value)
    assert.equal(echoValue.echoed, 'nilo-host')
    assert.equal(echoValue.pid, process.pid)
    assert.equal(host.runtime.toolUsesSubset('proof_echo'), false)

    const command = await call(host, '/v1/commands/execute', { body: { line: '/proof hello' } })
    const commandBody = asRecord(command.json)
    const commandResult = asRecord(commandBody.result)
    assert.equal(commandResult.kind, 'success')
    assert.equal(commandResult.text, `proof hello pid ${String(process.pid)}`)

    const emitted = await call(host, '/v1/events/emit', { body: { name: 'proof/ping', payload: { n: 1 } } })
    assert.equal(emitted.status, 200)
    const heard = await call(host, '/v1/tools/invoke', { body: { name: 'proof_seen', args: {} } })
    const heardValue = asRecord(asRecord(heard.json).value)
    assert.deepEqual(heardValue.events, [{ n: 1 }])
    assert.equal(heardValue.pid, process.pid)

    const services = await call(host, '/v1/services')
    const rows = asRecord(services.json).services
    assert.ok(Array.isArray(rows))
    const proof = rows.map((row) => asRecord(row)).find((row) => row.name === 'proofMark')
    assert.ok(proof)
    assert.ok(Array.isArray(proof.chain))
    assert.ok(proof.chain.includes('Service'))
    const internal = await call(host, '/v1/events/emit', { body: { name: 'internal/plugin', payload: {} } })
    assert.equal(internal.status, 400)
  })
})

test('proof 2: the DSH directory-picker service, which imports only Cordis, registers on this host', async () => {
  await withHost(async (host) => {
    const marked = globalThis as typeof globalThis & { oharnessDirectoryPickerProofEvaluated?: number }
    delete marked.oharnessDirectoryPickerProofEvaluated
    const seen = await preview(host, directoryPickerDir)
    assert.equal(seen.runtime, 'in-process')
    assert.equal(seen.name, '@oharness/proof-dsh-directory-picker')
    const installed = await installConfirmed(host, directoryPickerDir)
    assert.equal(installed.status, 200)
    assert.equal(installed.json.status, 'active')
    assert.equal(marked.oharnessDirectoryPickerProofEvaluated, 1)

    const services = await call(host, '/v1/services')
    const rows = asRecord(services.json).services
    assert.ok(Array.isArray(rows))
    const picker = rows.map((row) => asRecord(row)).find((row) => row.name === 'directoryPicker')
    assert.ok(picker)
    assert.deepEqual(picker.chain, ['ProofDirectoryPicker', 'DirectoryPicker', 'Service'])

    const vendor = await import(pathToFileURL(directoryPickerSource).href) as {
      DirectoryPicker: abstract new (...args: never) => object
      DirectoryPickerError: abstract new (...args: never) => Error
    }
    const live = host.runtime.context.get('directoryPicker') as unknown as {
      constructor: abstract new (...args: never) => object
      capability(): { kind: string }
      refuse(target: string): never
    }
    assert.equal(Object.getPrototypeOf(live.constructor), vendor.DirectoryPicker)
    assert.equal(live.capability().kind, 'native')
    assert.throws(() => live.refuse('relative'), (error: unknown) => error instanceof vendor.DirectoryPickerError)
  })
})

test('proof 3: DSH tool-todo registers todo_write on the tools subset and its own body enforces the agent session', async () => {
  await withHost(async (host) => {
    const seen = await preview(host, toolTodoDir)
    assert.equal(seen.name, '@deepseek-ai/dsh-tool-todo')
    assert.equal(seen.version, '0.2.2-rc.2')
    assert.equal(seen.runtime, 'in-process')
    assert.equal(seen.runtimeDefaulted, true)
    assert.equal(seen.capabilitiesDeclared, false)
    const missing = await call(host, '/v1/tools/invoke', {
      body: { name: 'todo_write', args: { todos: [{ content: 'Ship the host', status: 'pending' }] } },
    })
    assert.equal(asRecord(missing.json).ok, false)

    const installed = await installConfirmed(host, toolTodoDir, { allowParallelInProgress: false })
    assert.equal(installed.status, 200, JSON.stringify(installed.json))
    assert.equal(installed.json.status, 'active')
    assert.equal(installed.json.scriptsExecuted, false)
    assert.deepEqual(host.runtime.sessionProjectionKeys(), ['todos'])
    assert.equal(host.runtime.sessionProjectionApplyCalls(), 0)
    assert.equal(host.runtime.toolUsesSubset('todo_write'), true)

    const noAgent = await call(host, '/v1/tools/invoke', {
      body: { name: 'todo_write', args: { todos: [{ content: 'Ship the host', status: 'pending' }] } },
    })
    assert.equal(asRecord(noAgent.json).ok, false)
    assert.match(String(asRecord(noAgent.json).error), /owning agent session/)

    const writes: { type: string; data: unknown }[] = []
    const recorded = await host.runtime.invokeTool(
      'todo_write',
      { todos: [{ content: 'Ship the host', status: 'pending' }] },
      {
        callId: 'proof-3',
        signal: new AbortController().signal,
        agent: { session: { append(type: string, data: unknown) { writes.push({ type, data }) } } },
      },
    )
    const value = asRecord(recorded)
    assert.deepEqual(asRecord(value.counts), { pending: 1, inProgress: 0, completed: 0 })
    assert.equal(writes[0]?.type, 'todo/write')
    assert.equal(host.runtime.sessionProjectionApplyCalls(), 0)

    await assert.rejects(
      () => host.runtime.invokeTool(
        'todo_write',
        { todos: [{ content: '   ', status: 'pending' }] },
        {
          callId: 'proof-3-empty',
          signal: new AbortController().signal,
          agent: { session: { append() {} } },
        },
      ),
      /content/,
    )
    await assert.rejects(
      () => host.runtime.invokeTool(
        'todo_write',
        { todos: [{ content: 'One', status: 'in_progress' }, { content: 'Two', status: 'in_progress' }] },
        {
          callId: 'proof-3-parallel',
          signal: new AbortController().signal,
          agent: { session: { append() {} } },
        },
      ),
      /in_progress/,
    )

    const extra = await host.runtime.invokeTool(
      'todo_write',
      { todos: [{ content: 'Ship the host', status: 'pending', extra: true }] },
      {
        callId: 'proof-3-extra',
        signal: new AbortController().signal,
        agent: { session: { append() {} } },
      },
    )
    assert.equal(asRecord(asRecord(extra).counts).pending, 1)
    assert.equal(host.runtime.toolUsesSubset('todo_write'), true)
  })
})
