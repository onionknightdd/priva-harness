import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { RUN_WEBSOCKET_PATH } from '../../../../src/transport/websocket/run-route.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('WS /api/sandbox/agent/ws/run', () => {
  let testRoot: string
  let server: FastifyInstance
  let modelReference: string
  let claudeProvider: FakeAgentProvider
  let piProvider: FakeAgentProvider
  let liveRuns: LiveRunRegistry
  let agentProfileService: ReturnType<typeof createTestAgentServices>['agentProfileService']

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-ws-run-test-'))
    claudeProvider = new FakeAgentProvider('claude', [
      {
        type: 'assistant.delta',
        messageId: 'msg_1',
        blockId: 'msg_1:0',
        index: 0,
        text: 'Hello',
      },
      {
        type: 'assistant.message',
        messageId: 'msg_1',
        blocks: [{ type: 'text', blockId: 'msg_1:0', index: 0, text: 'Hello' }],
      },
      {
        type: 'run.completed',
        sessionId: 'sess-1',
        model: 'm',
        durationMs: 5,
        usage: { input: 1, output: 1 },
      },
    ])
    piProvider = new FakeAgentProvider('pi', [
      {
        type: 'assistant.delta',
        messageId: 'msg_1',
        blockId: 'msg_1:0',
        index: 0,
        text: 'Hi',
      },
      {
        type: 'run.completed',
        sessionId: 'pi-1',
        model: 'm',
        durationMs: 3,
      },
    ])
    const services = createTestAgentServices(join(testRoot, 'runtime'))
    const { modelProfileService } = services
    agentProfileService = services.agentProfileService
    const profile = await modelProfileService.createProfile({
      label: 'Gateway',
      baseUrl: 'https://api.example.com/v1',
      authToken: 'secret',
      defaultModel: 'm',
    })
    modelReference = `${profile.id}:m`
    liveRuns = new LiveRunRegistry()
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({ initialDirectory: testRoot }),
      modelProfileService,
      agentProfileService,
      agentHarness: new AgentHarness({
        providers: {
          claude: claudeProvider,
          pi: piProvider,
        },
        cwd: testRoot,
        liveRuns,
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
      cwd: testRoot,
    }))
    const received = await frames

    expect(received[0]).toMatchObject({ type: 'run.started', v: 1, seq: 1, harness: 'claude' })
    expect(received[0]).toHaveProperty('runId')
    expect(received[0]).toHaveProperty('seq')
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant.delta', text: 'Hello' }),
      expect.objectContaining({
        type: 'run.completed',
        model: 'm',
        durationMs: 5,
      }),
    ]))
    expect(claudeProvider.targets[0]).toMatchObject({ kind: 'new', provider: 'claude' })
    expect(claudeProvider.targets[0]).toHaveProperty('sessionId')
  })

  it('returns an error frame for a missing init text', async () => {
    const socket = await server.injectWS(RUN_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({ type: 'init', text: '' }))
    expect(await frames).toEqual([
      expect.objectContaining({
        type: 'error',
        message: 'Init text must be a non-empty string',
        v: 1,
        seq: 1,
        harness: 'unknown',
      }),
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
      cwd: testRoot,
    }))
    expect(await frames).toEqual([
      expect.objectContaining({
        type: 'error',
        message: 'profile_not_found',
        v: 1,
        seq: 1,
        harness: 'claude',
      }),
    ])
  })

  it('routes pi to the Pi provider with a /v1 base URL', async () => {
    const socket = await server.injectWS(RUN_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'init',
      text: 'hi',
      model: modelReference,
      harness: 'pi',
      cwd: testRoot,
    }))
    const received = await frames

    expect(claudeProvider.specs).toEqual([])
    expect(piProvider.specs).toEqual([
      expect.objectContaining({
        provider: 'pi',
        model: 'm',
        baseUrl: 'https://api.example.com/v1',
        authToken: 'secret',
        cwd: testRoot,
        queueBehavior: 'follow-up',
      }),
    ])
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant.delta', text: 'Hi' }),
      expect.objectContaining({
        type: 'run.completed',
        harness: 'pi',
      }),
    ]))
  })

  it('resumes claude and pi sessions and rejects pi fork', async () => {
    const resume = await server.injectWS(RUN_WEBSOCKET_PATH)
    const resumeFrames = collectFrames(resume)
    resume.send(JSON.stringify({
      type: 'init',
      text: 'again',
      model: modelReference,
      harness: 'claude',
      cwd: '/work/repo',
      sessionId: 'sess-1',
      effort: 'low',
    }))
    await resumeFrames

    expect(claudeProvider.targets).toEqual([
      {
        kind: 'resume',
        session: { provider: 'claude', id: 'sess-1' },
      },
    ])
    expect(claudeProvider.specs.at(-1)).toEqual(expect.objectContaining({
      cwd: '/work/repo',
      effort: 'low',
    }))

    const piResume = await server.injectWS(RUN_WEBSOCKET_PATH)
    const piResumeFrames = collectFrames(piResume)
    piResume.send(JSON.stringify({
      type: 'init',
      text: 'hi',
      model: modelReference,
      harness: 'pi',
      cwd: testRoot,
      sessionId: 'pi-1',
    }))
    await piResumeFrames
    expect(piProvider.targets).toEqual([
      { kind: 'resume', session: { provider: 'pi', id: 'pi-1' } },
    ])

    const denied = await server.injectWS(RUN_WEBSOCKET_PATH)
    const deniedFrames = collectFrames(denied)
    denied.send(JSON.stringify({
      type: 'init',
      text: 'hi',
      model: modelReference,
      harness: 'pi',
      cwd: testRoot,
      sessionId: 'pi-1',
      fork: true,
    }))
    expect(await deniedFrames).toEqual([
      expect.objectContaining({
        type: 'error',
        message: 'Pi does not support fork',
        v: 1,
        seq: 1,
      }),
    ])
  })

  it('applies queueBehavior from settings and ignores it on the init frame', async () => {
    await agentProfileService.updateQueueBehavior('steer')

    const socket = await server.injectWS(RUN_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'init',
      text: 'hi',
      model: modelReference,
      harness: 'pi',
      cwd: testRoot,
      queueBehavior: 'interrupt',
    }))
    await frames

    expect(piProvider.specs.at(-1)).toEqual(expect.objectContaining({
      queueBehavior: 'steer',
    }))
  })

  it('keeps a live run after the socket closes and replays on attach', async () => {
    let releaseGate = (): void => undefined
    claudeProvider.gate = new Promise((resolve) => {
      releaseGate = resolve
    })
    const socket = await server.injectWS(RUN_WEBSOCKET_PATH)
    socket.send(JSON.stringify({
      type: 'init',
      text: 'hi',
      model: modelReference,
      harness: 'claude',
      cwd: testRoot,
    }))
    const live = await waitFor(() => liveRuns.listActive()[0])
    expect(live.sessionId).toEqual(expect.any(String))
    socket.close()
    expect(liveRuns.listActive()).toHaveLength(1)

    const attach = await server.injectWS(RUN_WEBSOCKET_PATH)
    const received: unknown[] = []
    const closed = new Promise<void>((resolve, reject) => {
      attach.on('message', (data: unknown) => {
        received.push(JSON.parse(String(data)) as unknown)
      })
      attach.on('close', () => resolve())
      attach.on('error', reject)
    })
    attach.send(JSON.stringify({
      type: 'attach',
      harness: 'claude',
      sessionId: live.sessionId,
      sinceSeq: 0,
    }))
    await waitFor(() => received[0])
    expect(received[0]).toMatchObject({ type: 'run.started', runId: live.runId })
    releaseGate()
    await closed
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'run.started', runId: live.runId }),
      expect.objectContaining({ type: 'run.completed', runId: live.runId }),
    ]))
    expect(liveRuns.listActive()).toEqual([])
  })

  it('aborts a live run from an abort frame after disconnect', async () => {
    claudeProvider.gate = new Promise(() => undefined)
    const socket = await server.injectWS(RUN_WEBSOCKET_PATH)
    socket.send(JSON.stringify({
      type: 'init',
      text: 'hi',
      model: modelReference,
      harness: 'claude',
      cwd: testRoot,
    }))
    const live = await waitFor(() => liveRuns.listActive()[0])
    socket.close()

    const abortSocket = await server.injectWS(RUN_WEBSOCKET_PATH)
    const frames = collectFrames(abortSocket)
    abortSocket.send(JSON.stringify({
      type: 'abort',
      harness: 'claude',
      sessionId: live.sessionId,
      runId: live.runId,
    }))
    const received = await frames
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'run.aborted', runId: live.runId }),
    ]))
    expect(liveRuns.listActive()).toEqual([])
  })

  it('rejects a second init while the session is live', async () => {
    claudeProvider.gate = new Promise(() => undefined)
    const socket = await server.injectWS(RUN_WEBSOCKET_PATH)
    socket.send(JSON.stringify({
      type: 'init',
      text: 'hi',
      model: modelReference,
      harness: 'claude',
      cwd: testRoot,
      sessionId: 'sess-busy',
    }))
    await waitFor(() => liveRuns.listActive()[0])

    const busy = await server.injectWS(RUN_WEBSOCKET_PATH)
    const frames = collectFrames(busy)
    busy.send(JSON.stringify({
      type: 'init',
      text: 'again',
      model: modelReference,
      harness: 'claude',
      cwd: testRoot,
      sessionId: 'sess-busy',
    }))
    expect(await frames).toEqual([
      expect.objectContaining({
        type: 'error',
        message: 'Session has a live run',
      }),
    ])
    socket.close()
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

async function waitFor<T>(read: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() - started > timeoutMs) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
