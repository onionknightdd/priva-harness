import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { DurableEvent } from '../../../../src/core/agent-api/events.js'
import { sessionSnapshotSchema } from '../../../../src/core/agent-api/objects.js'
import {
  messageAcceptedSchema,
  messageResultSchema,
  runResultSchema,
  runsPageSchema,
  sessionCreatedSchema,
} from '../../../../src/core/agent-api/responses.js'
import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { AGENT_API, createAgentApiFixture, type AgentApiFixture } from '../../../support/agent-api.js'

const TEXT_RUN: readonly AgentEvent[] = [
  { type: 'assistant.block_start', messageId: 'msg_a', blockId: 'msg_a:0', index: 0, kind: 'text' },
  { type: 'assistant.delta', messageId: 'msg_a', blockId: 'msg_a:0', index: 0, text: 'Hello' },
  { type: 'assistant.message', messageId: 'msg_a', blocks: [{ type: 'text', blockId: 'msg_a:0', index: 0, text: 'Hello' }] },
  { type: 'run.completed', model: 'claude-sonnet-4-5', durationMs: 1200 },
]

const QUESTION = { question: 'Include shipping.ts?', options: [{ label: 'Yes' }, { label: 'No' }] }

describe('Agent API for programmatic callers', () => {
  let fixture: AgentApiFixture
  afterEach(async () => {
    expect(fixture.errors).toEqual([])
    await fixture.close()
  })

  async function createSession(payload: Record<string, unknown> = { workdir: 'projects/shop-web' }) {
    const response = await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions`, payload })
    expect(response.statusCode).toBe(201)
    return sessionCreatedSchema.parse(response.json()).session
  }

  function send(ses: string, payload: Record<string, unknown>) {
    return fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions/${ses}/messages`,
      payload: { message: { parts: [{ type: 'text', text: 'List the files without tests' }] }, ...payload } })
  }

  function getRun(ses: string, run: string, query = '') {
    return fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${ses}/runs/${run}${query}` })
  }

  async function idle(ses: string): Promise<void> {
    await expect.poll(async () => sessionSnapshotSchema.parse((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${ses}` })).json()).status.state).toBe('idle')
  }

  async function durableLog(ses: string): Promise<DurableEvent[]> {
    const events: DurableEvent[] = []
    const subscription = await fixture.service.subscribe(ses, { after: 0, deltas: false, threads: 'all' }, (event) => {
      if ('seq' in event) events.push(event)
    })
    subscription.close()
    return events
  }

  async function nativeRef(ses: string) {
    const stored = JSON.parse(await readFile(join(fixture.runtimeHome, 'agent-api', 'sessions', ses, 'session.json'), 'utf8')) as { nativeId: string }
    return { provider: 'claude' as const, id: stored.nativeId }
  }

  it('waits for the run and returns its final text', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN })
    const { id: ses } = await createSession()
    const response = await send(ses, { response: 'wait' })
    expect(response.statusCode).toBe(200)
    const result = messageResultSchema.parse(response.json())
    expect(result).toMatchObject({ run: { status: 'completed', stop_reason: 'end_turn', output_text: 'Hello' }, interactions: [], last_event_seq: 0 })
    const read = await getRun(ses, result.run.id)
    expect(read.statusCode).toBe(200)
    expect(runResultSchema.parse(read.json())).toEqual({ run: result.run, interactions: [] })
  })

  it('answers 202 when the wait limit passes and keeps waiting through GET', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN }, { maxWaitMs: 50 })
    let release!: () => void
    fixture.claude.gate = new Promise((resolve) => { release = resolve })
    const { id: ses } = await createSession()
    const response = await send(ses, { response: 'wait' })
    expect(response.statusCode).toBe(202)
    const { run } = messageAcceptedSchema.parse(response.json())
    const pending = await getRun(ses, run.id, '?wait=true')
    expect(pending.statusCode).toBe(200)
    expect(runResultSchema.parse(pending.json()).run.status).toBe('in_progress')
    release()
    await expect.poll(async () => runResultSchema.parse((await getRun(ses, run.id, '?wait=true')).json()).run)
      .toMatchObject({ status: 'completed', output_text: 'Hello' })
  })

  it('declines a question nobody is there to answer and lets the run finish', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN })
    fixture.claude.question = QUESTION
    const { id: ses } = await createSession()
    const response = await send(ses, { response: 'wait' })
    expect(messageResultSchema.parse(response.json()).run).toMatchObject({ status: 'completed', output_text: 'Hello' })
    expect(fixture.claude.resolutions).toMatchObject([{ decision: 'deny', reason: 'unattended' }])
    const interactionEvents = (await durableLog(ses)).filter((event) => event.type.startsWith('interaction.'))
    expect(interactionEvents.map((event) => 'interaction' in event ? [event.type, event.interaction.status, event.interaction.resolution?.reason] : []))
      .toEqual([['interaction.requested', 'pending', undefined], ['interaction.resolved', 'resolved', 'unattended']])
    const history = runsPageSchema.parse((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${ses}/runs` })).json())
    expect(history.data[0]?.items.map((item) => [item.type, item.status])).toEqual([['tool_call', 'declined'], ['message', 'completed']])
  })

  it('pauses an interruptible run until its question is answered', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN })
    fixture.claude.question = QUESTION
    const { id: ses } = await createSession()
    const response = await send(ses, { response: 'wait', allow_interrupt: true })
    expect(response.statusCode).toBe(200)
    const paused = messageResultSchema.parse(response.json())
    expect(paused.run.status).toBe('in_progress')
    expect(paused.interactions).toMatchObject([{ type: 'question', status: 'pending', run_id: paused.run.id, questions: [{ question: QUESTION.question }] }])
    const ref = await nativeRef(ses)
    const request = fixture.harness.sessionStream(ref).snapshot().interactions?.[0]
    if (request === undefined) throw new Error('Expected a pending interaction')
    fixture.harness.respondPermission(ref, { requestId: request.requestId, decision: 'allow', answers: { q0: { selected: ['Yes'], text: '' } } })
    const finished = runResultSchema.parse((await getRun(ses, paused.run.id, '?wait=true')).json())
    expect(finished).toMatchObject({ run: { status: 'completed', output_text: 'Hello' }, interactions: [] })
    expect(fixture.claude.resolutions).toMatchObject([{ decision: 'allow', reason: 'answered' }])
  })

  it('runs a Claude session in the mode chosen at creation and ignores the mode for Pi', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN, pi: [{ type: 'run.completed', model: 'pi-model', durationMs: 1 }] })
    const claude = await createSession({ workdir: 'projects/shop-web', run_mode: 'code' })
    expect(claude.run_mode).toBe('code')
    expect((await send(claude.id, { response: 'accepted' })).statusCode).toBe(202)
    await idle(claude.id)
    expect(fixture.claude.specs[0]?.runMode).toBe('code')

    const pi = await createSession({ harness: 'pi', run_mode: 'code' })
    expect(pi).not.toHaveProperty('run_mode')
    expect((await send(pi.id, { response: 'accepted' })).statusCode).toBe(202)
    await idle(pi.id)
    expect(fixture.pi.specs[0]?.runMode).toBeUndefined()
  })

  it('reports an unknown run as not found', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN })
    const { id: ses } = await createSession()
    const response = await getRun(ses, 'run_missing')
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})
