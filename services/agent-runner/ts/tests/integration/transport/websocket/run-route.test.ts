import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { RUN_WEBSOCKET_PATH } from '../../../../src/transport/websocket/run-route.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { createTestModelProfileService } from '../../../support/model-profile.js'

describe('WS /api/sandbox/agent/ws/run', () => {
  let testRoot: string
  let server: FastifyInstance
  let modelReference: string
  let claudeProvider: FakeAgentProvider
  let piProvider: FakeAgentProvider

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-ws-run-test-'))
    claudeProvider = new FakeAgentProvider('claude', [
      { type: 'assistant', event: 'text_delta', text: 'Hello' },
      { type: 'assistant', event: 'message', text: 'Hello' },
      {
        type: 'run',
        event: 'completed',
        sessionId: 'sess-1',
        harnessProvider: 'claude',
        model: 'm',
        durationMs: 5,
        usage: { input: 1, output: 1 },
      },
    ])
    piProvider = new FakeAgentProvider('pi', [
      { type: 'assistant', event: 'text_delta', text: 'Hi' },
      {
        type: 'run',
        event: 'completed',
        sessionId: 'pi-1',
        harnessProvider: 'pi',
        model: 'm',
        durationMs: 3,
      },
    ])
    const modelProfileService = createTestModelProfileService(join(testRoot, 'runtime'))
    const profile = await modelProfileService.createProfile({
      label: 'Gateway',
      baseUrl: 'https://api.example.com/v1',
      authToken: 'secret',
      defaultModel: 'm',
    })
    modelReference = `${profile.id}:m`
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({ initialDirectory: testRoot }),
      modelProfileService,
      agentHarness: new AgentHarness({
        providers: {
          claude: claudeProvider,
          pi: piProvider,
        },
        cwd: testRoot,
      }),
    })
    await server.ready()
  })

  afterEach(async () => {
    await server.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('streams nested events then closes after the completed frame', async () => {
    const socket = await server.injectWS(RUN_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'init',
      text: 'hi',
      model: modelReference,
      harness: 'claude',
    }))
    const received = await frames

    expect(received[0]).toMatchObject({ type: 'run', event: 'started' })
    expect(received[0]).toHaveProperty('runId')
    expect(received[0]).not.toHaveProperty('seq')
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant', event: 'text_delta', text: 'Hello' }),
      expect.objectContaining({
        type: 'run',
        event: 'completed',
        sessionId: 'sess-1',
        harnessProvider: 'claude',
        model: 'm',
        durationMs: 5,
      }),
    ]))
  })

  it('returns an error frame for a missing init text', async () => {
    const socket = await server.injectWS(RUN_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({ type: 'init', text: '' }))
    expect(await frames).toEqual([
      { type: 'error', message: 'Init text must be a non-empty string' },
    ])
  })

  it('returns an error frame when the profile cannot be resolved', async () => {
    const socket = await server.injectWS(RUN_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'init',
      text: 'hi',
      model: 'missing:model-a',
      harness: 'claude',
    }))
    expect(await frames).toEqual([
      { type: 'error', message: 'profile_not_found' },
    ])
  })

  it('routes bambuddy to Pi with a /v1 base URL', async () => {
    const socket = await server.injectWS(RUN_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'init',
      text: 'hi',
      model: modelReference,
      harness: 'bambuddy',
    }))
    const received = await frames

    expect(claudeProvider.specs).toEqual([])
    expect(piProvider.specs).toEqual([
      expect.objectContaining({
        provider: 'pi',
        model: 'm',
        baseUrl: 'https://api.example.com/v1',
        authToken: 'secret',
      }),
    ])
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant', event: 'text_delta', text: 'Hi' }),
      expect.objectContaining({
        type: 'run',
        event: 'completed',
        harnessProvider: 'pi',
      }),
    ]))
  })
})

function collectFrames(socket: { on: (event: string, listener: (...args: unknown[]) => void) => void }): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const frames: unknown[] = []
    socket.on('message', (data: unknown) => {
      frames.push(JSON.parse(String(data)) as unknown)
    })
    socket.on('close', () => resolve(frames))
    socket.on('error', reject)
  })
}
