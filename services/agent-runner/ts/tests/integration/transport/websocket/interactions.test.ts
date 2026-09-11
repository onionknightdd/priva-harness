import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentProvider, AgentRuntime, SessionTarget, TurnContext } from '../../../../src/core/contract/agent-provider.js'
import type { AgentEvent, StreamFrame } from '../../../../src/core/event/agent-event.js'
import type { InteractionRequest, InteractionResponse } from '../../../../src/core/resource/interaction.js'
import { emptyContextUsage } from '../../../../src/core/resource/context-usage.js'
import { InteractionCoordinator } from '../../../../src/core/run/interaction-coordinator.js'
import type { UserTurn } from '../../../../src/core/run/user-turn.js'
import { AsyncQueue } from '../../../../src/core/stream/async-queue.js'
import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { SESSION_WEBSOCKET_PATH } from '../../../../src/transport/websocket/run-route.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { FakeSessionStore } from '../../../support/fake-session-store.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

class WaitingRuntime implements AgentRuntime {
  readonly session
  readonly events = new AsyncQueue<AgentEvent>()
  readonly coordinator = new InteractionCoordinator((event) => this.events.push(event))
  readonly decisions: string[] = []
  constructor(target: SessionTarget) {
    this.session = { provider: 'claude' as const, id: target.kind === 'resume' ? target.session.id : target.sessionId ?? 'waiting' }
  }
  async *run(_turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent> {
    const waiting = Promise.all(['Bash', 'Write'].map((tool) => this.coordinator.request({ kind: 'tool', tool }, { signal: context.signal })))
    void waiting.then((results) => {
      this.decisions.push(...results.map((result) => result.decision))
      this.events.push({ type: 'run.completed', sessionId: this.session.id, model: 'm', durationMs: 1 })
      this.events.close()
    })
    yield* this.events.iterate()
  }
  respondPermission(response: InteractionResponse): void { this.coordinator.respond(response) }
  applyRunSpec(): Promise<void> { return Promise.resolve() }
  abort(): Promise<void> { this.coordinator.cancelAll(); return Promise.resolve() }
  getContextUsage() { return Promise.resolve(emptyContextUsage()) }
  release(): Promise<void> { this.coordinator.cancelAll(); this.events.close(); return Promise.resolve() }
}

function inbox(socket: WebSocket) {
  const frames: StreamFrame[] = []
  socket.on('message', (raw) => { frames.push(JSON.parse((Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw)).toString('utf8')) as StreamFrame) })
  const wait = async (predicate: (frame: StreamFrame) => boolean) => {
    await expect.poll(() => frames.some(predicate), { timeout: 3000 }).toBe(true)
    const found = frames.find(predicate)
    if (!found) throw new Error('Missing frame')
    return found
  }
  return { frames, wait, send: (value: unknown) => socket.send(JSON.stringify(value)) }
}

describe('interaction WebSocket routing', () => {
  let root: string
  let server: FastifyInstance
  let harness: AgentHarness
  let model: string
  let runtime: WaitingRuntime
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'priva-interaction-ws-'))
    const services = createTestAgentServices(join(root, 'runtime'))
    const profile = await services.modelProfileService.createProfile({ label: 'Test', baseUrl: 'https://api.example.com/v1', authToken: 'test', defaultModel: 'm' })
    model = `${profile.id}:m`
    const provider: AgentProvider = {
      id: 'claude', sessions: new FakeSessionStore(), listSlashCommands: () => Promise.resolve([]),
      openSession: (target) => { runtime = new WaitingRuntime(target); return Promise.resolve(runtime) },
    }
    harness = new AgentHarness({ providers: { claude: provider, pi: new FakeAgentProvider('pi', []) }, cwd: root, liveRuns: new LiveRunRegistry() })
    server = buildHttpServer({ ...services, userFileSystem: new NodeUserFileSystem({ initialDirectory: root }), agentHarness: harness })
    await server.ready()
  })
  afterEach(async () => { await harness.disposePool(); await server.close(); await rm(root, { recursive: true, force: true }) })

  async function start() {
    const socket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const client = inbox(socket)
    client.send({ type: 'run.start', harness: 'claude', model, cwd: root, text: 'ask before acting' })
    await expect.poll(() => client.frames.filter((frame) => frame.type === 'permission.requested').length).toBe(2)
    const requests = client.frames.flatMap((frame) => frame.type === 'permission.requested' ? [frame.request] : [])
    const first = requests[0]; const second = requests[1]
    if (!first || !second) throw new Error('Missing requests')
    const response = (request: InteractionRequest, decision: 'allow' | 'deny') => ({ type: 'permission.respond', harness: 'claude', sessionId: runtime.session.id, requestId: request.requestId, decision })
    return { ...client, socket, first, second, response }
  }

  it('routes responses to the suspended runtime, acknowledges both tabs and restores the queue on reconnect', async () => {
    const client = await start()
    expect(runtime.decisions).toEqual([])
    const observerSocket = await server.injectWS(SESSION_WEBSOCKET_PATH)
    const observer = inbox(observerSocket)
    observer.send({ type: 'session.subscribe', harness: 'claude', sessionId: runtime.session.id })
    expect(await observer.wait((frame) => frame.type === 'session.snapshot')).toMatchObject({ interactions: [client.first, client.second] })

    client.send({ ...client.response(client.first, 'allow'), sessionId: 'different-session' })
    expect(await client.wait((frame) => frame.type === 'error')).toMatchObject({ code: 'permission.respond', requestId: client.first.requestId })
    client.send(client.response(client.first, 'deny'))
    expect(await observer.wait((frame) => frame.type === 'permission.resolved')).toMatchObject({ resolution: { decision: 'deny' } })
    observer.send(client.response(client.first, 'allow'))
    await expect.poll(() => observer.frames.filter((frame) => frame.type === 'permission.resolved').length).toBe(2)
    expect(observer.frames.filter((frame) => frame.type === 'permission.resolved').every((frame) => frame.resolution.decision === 'deny')).toBe(true)
    client.socket.close()

    const reconnect = inbox(await server.injectWS(SESSION_WEBSOCKET_PATH))
    reconnect.send({ type: 'session.subscribe', harness: 'claude', sessionId: runtime.session.id })
    expect(await reconnect.wait((frame) => frame.type === 'session.snapshot')).toMatchObject({ interactions: [client.second] })
    reconnect.send(client.response(client.second, 'allow'))
    await reconnect.wait((frame) => frame.type === 'run.completed')
    expect(runtime.decisions).toEqual(['deny', 'allow'])
    expect(harness.sessionStream(runtime.session).snapshot().interactions).toEqual([])
  })

  it('rejects replies before subscribing and clears all cards when the waiting run is aborted', async () => {
    const client = await start()
    const stranger = inbox(await server.injectWS(SESSION_WEBSOCKET_PATH))
    stranger.send(client.response(client.first, 'allow'))
    expect(await stranger.wait((frame) => frame.type === 'error')).toMatchObject({ requestId: client.first.requestId })
    client.send({ type: 'run.abort', harness: 'claude', sessionId: runtime.session.id })
    await client.wait((frame) => frame.type === 'run.aborted')
    expect(runtime.decisions).toEqual(['deny', 'deny'])
    expect(harness.sessionStream(runtime.session).snapshot().interactions).toEqual([])
    const cancelled = client.frames.filter((frame) => frame.type === 'permission.resolved')
    expect(cancelled).toHaveLength(2)
    expect(cancelled.every((frame) => frame.resolution.decision === 'deny')).toBe(true)
  })
})
