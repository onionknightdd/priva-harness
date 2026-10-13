import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import type { StreamFrame } from '../../../../src/core/event/agent-event.js'
import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { SESSION_WEBSOCKET_PATH } from '../../../../src/transport/websocket/run-route.js'
import { fakeStructuredTerminal } from '../../../support/fake-structured-terminal.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('WS /api/sandbox/agent/ws/session', () => {
  let testRoot: string
  let server: FastifyInstance
  let modelReference: string
  let claudeProvider: FakeAgentProvider
  let piProvider: ReturnType<typeof fakeStructuredTerminal>['provider']
  let liveRuns: LiveRunRegistry
  let harness: AgentHarness
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
    const native = fakeStructuredTerminal([
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
    ], claudeProvider)
    piProvider = native.provider
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
    harness = new AgentHarness({
      providers: {
        claude: claudeProvider,
        pi: piProvider,
      },
      cwd: testRoot,
      liveRuns,
    })
    harness.configureTerminalChats(native.terminals, () => 'http://localhost/events')
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({ initialDirectory: testRoot }),
      modelProfileService,
      agentProfileService,
      agentHarness: harness,
    })
    await server.ready()
  })

  afterEach(async () => {
    await harness.disposePool()
    await server.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('streams nested events through the completed frame', async () => {
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'run.start',
      text: 'hi',
      model: modelReference,
      harness: 'pi',
      cwd: testRoot,
    }))
    const received = await frames

    expect(received).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'session.snapshot', harness: 'pi' }), expect.objectContaining({ type: 'run.started', v: 2, harness: 'pi' })]))
    expect(received[0]).toHaveProperty('runId')
    expect(received[0]).toHaveProperty('seq')
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant.delta', text: 'Hi' }),
      expect.objectContaining({
        type: 'run.completed',
        model: 'm',
        durationMs: 3,
      }),
    ]))
    expect(piProvider.targets[0]).toMatchObject({ kind: 'new', provider: 'pi' })
    expect(received[0]).toHaveProperty('sessionId')
    expect(received.filter((frame) => ['assistant.delta', 'run.completed'].includes((frame as StreamFrame).type)).every((frame) => !(frame as StreamFrame).replay)).toBe(true)
    expect(piProvider.lastRuntime).toBeUndefined()
  })

  it.each(['claude', 'pi'] as const)('marks %s subscription history as replay without marking subsequent live tools', async (provider) => {
    const stream = harness.sessionStream({ provider, id: 'history' })
    const tool = { type: 'tool.started' as const, messageId: 'message', blockId: 'tool', id: 'tool', name: 'mcp__computer__list_apps' }
    const original = stream.publish(tool, 'old-run')
    stream.publish({ type: 'session.snapshot', messages: [], tasks: [] })
    stream.publish({ ...tool, id: 'nested', blockId: 'nested', parentToolUseId: 'agent' }, 'old-run')
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const received: StreamFrame[] = []
    socket.on('message', (data: unknown) => received.push(JSON.parse(String(data)) as StreamFrame))
    socket.send(JSON.stringify({ type: 'session.subscribe', harness: provider, sessionId: 'history', streamId: stream.streamId, sinceSeq: 0 }))
    await waitFor(() => received.length === 4 ? true : undefined)
    expect(received.slice(0, 3).every((frame) => frame.replay)).toBe(true)
    expect(received[3]).toMatchObject({ type: 'session.snapshot', seq: 3 })
    expect(original.replay).toBeUndefined()

    stream.publish({ ...tool, id: 'live', blockId: 'live' }, 'new-run')
    await waitFor(() => received[4])
    expect(received[4]).toMatchObject({ type: 'tool.started', id: 'live', seq: 4 })
    expect(received[4]?.replay).toBeUndefined()
    socket.close()
  })

  it('reports an unavailable Claude UI terminal without starting the SDK', async () => {
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({ type: 'run.start', harness: 'claude', text: 'hello', model: modelReference, cwd: testRoot }))
    expect(await frames).toEqual([expect.objectContaining({ type: 'error', message: 'The claude harness has no terminal driver' })])
    expect(claudeProvider.targets).toEqual([])
  })

  it('returns an error frame for a missing init text', async () => {
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({ type: 'run.start', text: '' }))
    expect(await frames).toEqual([
      expect.objectContaining({
        type: 'error',
        message: 'Init text must be a non-empty string',
        v: 2,
        seq: 1,
        harness: 'unknown',
      }),
    ])
  })

  it.each(['pi'] as const)('passes verified attachment-only turns to %s', async (harness) => {
    const path = join(testRoot, 'report.txt')
    await writeFile(path, 'report')
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'run.start', text: '', model: modelReference, harness, cwd: testRoot,
      attachments: [{ path, name: 'untrusted', mimeType: 'fake/type', size: 999 }],
    }))
    expect(await frames).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'run.completed' })]))
    const provider = piProvider
    expect(provider.turns).toEqual([{
      text: '', attachments: [{ path: await realpath(path), name: 'report.txt', mimeType: 'text/plain', size: 6 }],
    }])
  })

  it('does not launch the agent when an attachment is missing', async () => {
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'run.start', text: 'read this', model: modelReference, harness: 'pi', cwd: testRoot,
      attachments: [{ path: join(testRoot, 'missing.txt'), name: 'missing.txt', mimeType: 'text/plain', size: 1 }],
    }))
    expect(await frames).toEqual([expect.objectContaining({ type: 'error' })])
    expect(piProvider.turns).toEqual([])
  })

  it('returns an error frame when the profile cannot be resolved', async () => {
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'run.start',
      text: 'hi',
      model: 'missing:model-a',
      harness: 'pi',
      cwd: testRoot,
    }))
    expect(await frames).toEqual([
      expect.objectContaining({
        type: 'error',
        message: 'profile_not_found',
        v: 2,
        seq: 1,
        harness: 'pi',
      }),
    ])
  })

  it('routes pi to the Pi provider with a /v1 base URL', async () => {
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'run.start',
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

  it('resumes native sessions and rejects unsupported forks', async () => {
    const resume = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const resumeFrames = collectFrames(resume)
    resume.send(JSON.stringify({
      type: 'run.start',
      text: 'again',
      model: modelReference,
      harness: 'pi',
      cwd: '/work/repo',
      sessionId: 'sess-1',
      effort: 'low',
    }))
    await resumeFrames

    expect(piProvider.targets).toEqual([{ kind: 'resume', session: { provider: 'pi', id: 'sess-1' } }])
    expect(piProvider.specs.at(-1)).toEqual(expect.objectContaining({
      cwd: '/work/repo',
      effort: 'low',
    }))

    const piResume = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const piResumeFrames = collectFrames(piResume)
    piResume.send(JSON.stringify({
      type: 'run.start',
      text: 'hi',
      model: modelReference,
      harness: 'pi',
      cwd: testRoot,
      sessionId: 'pi-1',
    }))
    await piResumeFrames
    expect(piProvider.targets).toEqual([
      { kind: 'resume', session: { provider: 'pi', id: 'sess-1' } },
      { kind: 'resume', session: { provider: 'pi', id: 'pi-1' } },
    ])

    const denied = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const deniedFrames = collectFrames(denied)
    denied.send(JSON.stringify({
      type: 'run.start',
      text: 'hi',
      model: modelReference,
      harness: 'pi',
      cwd: testRoot,
      sessionId: 'pi-1',
      fork: true,
    }))
    expect(await deniedFrames).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        message: 'Pi does not support fork',
        v: 2,
      }),
    ]))
  })

  it('applies queueBehavior from settings and ignores it on the init frame', async () => {
    await agentProfileService.updateQueueBehavior('steer')

    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const frames = collectFrames(socket)
    socket.send(JSON.stringify({
      type: 'run.start',
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
    piProvider.gate = new Promise((resolve) => {
      releaseGate = resolve
    })
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    socket.send(JSON.stringify({
      type: 'run.start',
      text: 'hi',
      model: modelReference,
      harness: 'pi',
      cwd: testRoot,
      sessionId: 'disconnect-session',
    }))
    const sessionId = 'disconnect-session'
    const live = await waitFor(() => { const snapshot = harness.sessionStream({ provider: 'pi', id: sessionId }).snapshot(); return snapshot.activeRunId ? { sessionId, runId: snapshot.activeRunId } : undefined })
    socket.close()
    expect(harness.sessionStream({ provider: 'pi', id: live.sessionId }).snapshot().activeRunId).toBe(live.runId)

    const attach = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const received: unknown[] = []
    const closed = new Promise<void>((resolve, reject) => {
      attach.on('message', (data: unknown) => {
        received.push(JSON.parse(String(data)) as unknown)
      })
      attach.on('close', () => resolve())
      attach.on('error', reject)
    })
    attach.send(JSON.stringify({
      type: 'session.subscribe',
      harness: 'pi',
      sessionId: live.sessionId,
      sinceSeq: 0,
    }))
    await waitFor(() => received[0])
    expect(received[0]).toMatchObject({ type: 'session.snapshot', activeRunId: live.runId })
    releaseGate()
    await waitFor(() => received.find((frame) => (frame as { type: string }).type === 'run.completed'))
    expect(attach.readyState).toBe(1)
    attach.close()
    await closed
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session.snapshot', activeRunId: live.runId }),
      expect.objectContaining({ type: 'run.completed', runId: live.runId }),
    ]))
    expect(harness.sessionStream({ provider: 'pi', id: live.sessionId }).snapshot().activeRunId).toBeUndefined()
  })

  it('aborts a live run from an abort frame after disconnect', async () => {
    piProvider.gate = new Promise(() => undefined)
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    socket.send(JSON.stringify({
      type: 'run.start',
      text: 'hi',
      model: modelReference,
      harness: 'pi',
      cwd: testRoot,
      sessionId: 'abort-session',
    }))
    const sessionId = 'abort-session'
    const live = await waitFor(() => { const snapshot = harness.sessionStream({ provider: 'pi', id: sessionId }).snapshot(); return snapshot.activeRunId ? { sessionId, runId: snapshot.activeRunId } : undefined })
    socket.close()

    const abortSocket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const frames = collectFrames(abortSocket)
    abortSocket.send(JSON.stringify({
      type: 'run.abort',
      harness: 'pi',
      sessionId: live.sessionId,
      runId: live.runId,
    }))
    const received = await frames
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'run.aborted', runId: live.runId }),
    ]))
    expect(harness.sessionStream({ provider: 'pi', id: live.sessionId }).snapshot().activeRunId).toBeUndefined()
  })

  it('queues another turn and deduplicates repeated run IDs in the same native session', async () => {
    let releaseGate = (): void => undefined
    piProvider.gate = new Promise((resolve) => { releaseGate = resolve })
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const received: StreamFrame[] = []
    socket.on('message', (data: unknown) => received.push(JSON.parse(String(data)) as StreamFrame))
    const send = (runId: string, text: string) => socket.send(JSON.stringify({ type: 'run.start', text, model: modelReference, harness: 'pi', cwd: testRoot, sessionId: 'sess-busy', runId }))
    send('first', 'hi')
    await waitFor(() => piProvider.turns[0])
    send('first', 'duplicate')
    send('second', 'again')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(piProvider.turns).toEqual([{ text: 'hi' }])
    releaseGate()
    await waitFor(() => received.find((frame) => frame.type === 'run.completed' && frame.runId === 'second'))
    expect(piProvider.turns).toEqual([{ text: 'hi' }, { text: 'again' }])
    expect(piProvider.targets).toHaveLength(1)
    expect(received.filter((frame) => frame.type === 'run.started').map((frame) => frame.runId)).toEqual(['first', 'second'])
    expect(piProvider.lastRuntime).toBeUndefined()
    socket.close()
  })

})

function collectFrames(socket: { on: (event: string, listener: (...args: unknown[]) => void) => void }): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const frames: unknown[] = []
    socket.on('message', (data: unknown) => {
      const frame = JSON.parse(String(data)) as { type: string }
      frames.push(frame)
      if (['run.completed', 'run.failed', 'run.aborted', 'error'].includes(frame.type)) resolve(frames)
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
