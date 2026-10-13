import assert from 'node:assert/strict'
import { appendFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { TerminalInput } from '../../../../src/core/contract/terminal-service.js'
import { PiProvider } from '../../../../src/provider/pi/pi-provider.js'
import { PI_TERMINAL_FILES, readPiTerminalJson, type PiTerminalLaunchConfig } from '../../../../src/provider/pi/pi-terminal-protocol.js'
import { FakeSessionStore } from '../../../support/fake-session-store.js'
import { testRunSpec } from '../../../support/run-spec.js'

const roots: string[] = []
const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => { resolve() }) })))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const input: TerminalInput = { isAlive: () => Promise.resolve(true), capture: () => Promise.resolve(''), paste: () => Promise.resolve(), sendKeys: () => Promise.resolve() }

async function setup() {
  const scratchDir = await mkdtemp(join(tmpdir(), 'pi-terminal-provider-'))
  roots.push(scratchDir)
  const provider = new PiProvider({ open: () => Promise.reject(new Error('SDK should not open')) }, new FakeSessionStore(), join(scratchDir, 'agent'))
  const spec = testRunSpec({ provider: 'pi', profileId: 'profile-one' })
  const launch = await provider.terminalLaunch({ kind: 'new', provider: 'pi', sessionId: 'session' }, spec, { scratchDir, cols: 100, rows: 30 })
  const config = await readPiTerminalJson<PiTerminalLaunchConfig>(scratchDir, 'launch')
  assert.ok(config)
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${config.token}`)
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => { requests.push(JSON.parse(body)); response.writeHead(200).end('{}') })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.control), JSON.stringify({ port: address.port, token: config.token, instanceId: config.instanceId, ready: true }))
  return { provider, scratchDir, spec, launch, requests }
}

describe('Pi structured terminal provider', () => {
  it('keeps profile credentials in its private config and sends typed input with the run id', async () => {
    const { provider, scratchDir, launch, requests } = await setup()
    expect(provider.structuredTerminal).toBe(true)
    expect(launch.env).not.toHaveProperty('OPENAI_API_KEY')
    expect(launch.args).not.toContain('token')
    const signal = new AbortController().signal
    await provider.submitTerminalTurn(scratchDir, 'inspect these', signal, ['/work/a.png'], 'run-1')
    await provider.abortTerminal(scratchDir)
    await provider.respondTerminalInteraction(scratchDir, { requestId: 'question-1', decision: 'allow' })
    await provider.stopTerminalTask(scratchDir, 'task-1')
    expect(requests).toEqual([
      { type: 'prompt', text: 'inspect these', imagePaths: ['/work/a.png'], runId: 'run-1' },
      { type: 'abort' }, { type: 'respond', response: { requestId: 'question-1', decision: 'allow' } }, { type: 'stop-task', taskId: 'task-1' },
    ])
  })

  it('changes model configuration in place but restarts for a changed credential or classifier binding', async () => {
    const { provider, scratchDir, spec, requests } = await setup()
    const signal = new AbortController().signal
    expect(await provider.configureTerminal(input, scratchDir, { ...spec, model: 'new-model', effort: 'high', contextWindow: 1_000_000 }, signal)).toBe('applied')
    expect(requests).toEqual([{ type: 'configure', model: 'new-model', effort: 'high', contextWindow: 1_000_000 }])
    expect(await provider.configureTerminal(input, scratchDir, { ...spec, authToken: 'new-token' }, signal)).toBe('restart')
    expect(await provider.configureTerminal(input, scratchDir, { ...spec, classifier: { provider: 'priva-classifier-a', api: 'typesafe-system-one', modelId: 'jev', baseUrl: 'https://classifier.test', authToken: 'key' } }, signal)).toBe('restart')
    expect(requests).toHaveLength(1)
  })

  it('applies a requested effort when the launch spec matches but the restored native level differs', async () => {
    const { provider, scratchDir, spec, requests } = await setup()
    const requested = { ...spec, effort: 'high' as const, contextWindow: 200_000 as const }
    await writeFile(join(scratchDir, PI_TERMINAL_FILES.spec), JSON.stringify(requested))
    const status = { model: spec.model, effort: 'off', context: { limit: 200_000 } }
    await writeFile(join(scratchDir, PI_TERMINAL_FILES.status), JSON.stringify(status))
    const signal = new AbortController().signal
    expect(await provider.configureTerminal(input, scratchDir, requested, signal)).toBe('applied')
    expect(requests).toEqual([{ type: 'configure', model: spec.model, effort: 'high', contextWindow: 200_000 }])
    // An ordinary restore with no effort request must retain the native level.
    expect(await provider.configureTerminal(input, scratchDir, spec, signal)).toBe('applied')
    expect(requests).toHaveLength(1)
    await writeFile(join(scratchDir, PI_TERMINAL_FILES.status), JSON.stringify({ ...status, effort: 'high' }))
    expect(await provider.configureTerminal(input, scratchDir, requested, signal)).toBe('applied')
    expect(requests).toHaveLength(1)
  })
})

it('clears stale host snapshots on a new launch and rejects commands once the host exits', async () => {
  const { provider, scratchDir, spec } = await setup()
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.state), JSON.stringify({ sessionId: 'stale', phase: 'idle' }))
  await provider.terminalLaunch({ kind: 'new', provider: 'pi', sessionId: 'fresh' }, spec, { scratchDir, cols: 100, rows: 30 })
  expect(await readPiTerminalJson(scratchDir, 'state')).toBeUndefined()
  expect(await readPiTerminalJson(scratchDir, 'control')).toBeUndefined()
  const config = await readPiTerminalJson<PiTerminalLaunchConfig>(scratchDir, 'launch')
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.state), JSON.stringify({ instanceId: config?.instanceId, phase: 'exited' }))
  await expect(provider.abortTerminal(scratchDir)).rejects.toThrow('has exited')
})

it('restores pending startup questions on adoption without replaying completed accounting', async () => {
  const { provider, scratchDir } = await setup()
  const config = await readPiTerminalJson<PiTerminalLaunchConfig>(scratchDir, 'launch')
  const control = await readPiTerminalJson<Record<string, unknown>>(scratchDir, 'control')
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.control), JSON.stringify({ ...control, ready: false }))
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.state), JSON.stringify({ instanceId: config?.instanceId, phase: 'idle' }))
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.events), [
    { type: 'run.completed', costUsd: 1 },
    { type: 'permission.requested', request: { requestId: 'trust' } },
  ].map((event) => JSON.stringify({ instanceId: config?.instanceId, sessionId: 'session', event })).join('\n') + '\n')
  const telemetry = await provider.readTerminalTelemetry(scratchDir, -1)
  expect(telemetry.events.map((item) => item.event.type)).toEqual(['permission.requested'])
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.state), JSON.stringify({ instanceId: config?.instanceId, phase: 'idle', eventOffset: telemetry.offset }))
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.control), JSON.stringify({ ...control, ready: true }))
  expect((await provider.readTerminalTelemetry(scratchDir, -1)).events).toEqual([])
})

it('adopts only the current run after a telemetry history larger than one read batch', async () => {
  const { provider, scratchDir } = await setup()
  const config = await readPiTerminalJson<PiTerminalLaunchConfig>(scratchDir, 'launch')
  const activity = (event: unknown) => JSON.stringify({ instanceId: config?.instanceId, sessionId: 'session', event }) + '\n'
  const file = join(scratchDir, PI_TERMINAL_FILES.events)
  await writeFile(file, activity({ type: 'run.started', model: 'old-model' }))
  const oldLine = activity({ type: 'tool.progress', chunk: 'x'.repeat(1024 * 1024) })
  for (let index = 0; index < 65; index++) await appendFile(file, oldLine)
  await appendFile(file, activity({ type: 'run.completed', costUsd: 100 }))
  await appendFile(file, activity({ type: 'run.started', model: 'active-model' }) + activity({ type: 'tool.progress', chunk: '当前轮' }))
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.state), JSON.stringify({ instanceId: config?.instanceId, phase: 'running' }))
  const telemetry = await provider.readTerminalTelemetry(scratchDir, -1)
  expect(telemetry.events.map((item) => item.event.type)).toEqual(['run.started', 'tool.progress'])
  expect(telemetry.events[0]?.event).toMatchObject({ model: 'active-model' })
  expect((await provider.readTerminalTelemetry(scratchDir, telemetry.offset)).events).toEqual([])
})

it('keeps a turn appended after an idle snapshot and skips exited history on adoption', async () => {
  const { provider, scratchDir } = await setup()
  const config = await readPiTerminalJson<PiTerminalLaunchConfig>(scratchDir, 'launch')
  const file = join(scratchDir, PI_TERMINAL_FILES.events)
  const activity = (event: unknown) => JSON.stringify({ instanceId: config?.instanceId, sessionId: 'session', event }) + '\n'
  await writeFile(file, activity({ type: 'run.completed', costUsd: 100 }))
  const eventOffset = (await stat(file)).size
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.state), JSON.stringify({ instanceId: config?.instanceId, phase: 'idle', eventOffset }))
  // The host has appended the next start but its next state snapshot is not visible yet.
  await appendFile(file, activity({ type: 'run.started', model: 'new-run' }))
  expect((await provider.readTerminalTelemetry(scratchDir, -1)).events.map((item) => item.event.type)).toEqual(['run.started'])
  await writeFile(join(scratchDir, PI_TERMINAL_FILES.state), JSON.stringify({ instanceId: config?.instanceId, phase: 'exited', eventOffset: (await stat(file)).size }))
  expect((await provider.readTerminalTelemetry(scratchDir, -1)).events).toEqual([])
})
