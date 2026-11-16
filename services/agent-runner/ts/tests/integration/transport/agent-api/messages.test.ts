import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { agentApiEventSchema, type DurableEvent } from '../../../../src/core/agent-api/events.js'
import { sessionSnapshotSchema, type Item, type Run } from '../../../../src/core/agent-api/objects.js'
import { messageAcceptedSchema, runsPageSchema, sessionCreatedSchema } from '../../../../src/core/agent-api/responses.js'
import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { userTurnText } from '../../../../src/core/run/user-turn.js'
import { AGENT_API, createAgentApiFixture, parseSse, type AgentApiFixture } from '../../../support/agent-api.js'

const TEXT_RUN: readonly AgentEvent[] = [
  { type: 'assistant.block_start', messageId: 'msg_a', blockId: 'msg_a:0', index: 0, kind: 'text' },
  { type: 'assistant.delta', messageId: 'msg_a', blockId: 'msg_a:0', index: 0, text: 'Hel' },
  { type: 'assistant.delta', messageId: 'msg_a', blockId: 'msg_a:0', index: 0, text: 'lo' },
  { type: 'assistant.message', messageId: 'msg_a', blocks: [{ type: 'text', blockId: 'msg_a:0', index: 0, text: 'Hello' }] },
  { type: 'run.completed', model: 'claude-sonnet-4-5', durationMs: 1200, usage: { input: 10, output: 5, cacheRead: 2 }, costUsd: 0.01 },
]

const TOOL_RUN: readonly AgentEvent[] = [
  { type: 'assistant.block_start', messageId: 'msg_t', blockId: 'msg_t:0', index: 0, kind: 'thinking' },
  { type: 'assistant.thinking_delta', messageId: 'msg_t', blockId: 'msg_t:0', index: 0, text: 'Check the tests' },
  { type: 'tool.started', messageId: 'msg_t', blockId: 'toolu_1', index: 1, id: 'toolu_1', name: 'Bash' },
  { type: 'tool.input_delta', messageId: 'msg_t', blockId: 'toolu_1', index: 1, id: 'toolu_1', chunk: '{"command":"npm test"}' },
  { type: 'assistant.message', messageId: 'msg_t', blocks: [
    { type: 'thinking', blockId: 'msg_t:0', index: 0, text: 'Check the tests' },
    { type: 'tool_use', blockId: 'toolu_1', index: 1, id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } },
  ] },
  { type: 'tool.completed', messageId: 'msg_t', blockId: 'toolu_1', id: 'toolu_1', name: 'Bash', ok: false, output: '1 failed', durationMs: 80 },
  { type: 'assistant.block_start', messageId: 'msg_u', blockId: 'msg_u:0', index: 0, kind: 'text' },
  { type: 'assistant.delta', messageId: 'msg_u', blockId: 'msg_u:0', index: 0, text: 'One test fails.' },
  { type: 'run.completed', model: 'claude-sonnet-4-5', durationMs: 900 },
]

describe('Agent API messages and events', () => {
  let fixture: AgentApiFixture
  afterEach(async () => {
    expect(fixture.errors).toEqual([])
    await fixture.close()
  })

  async function createSession(payload: Record<string, unknown> = { workdir: 'projects/shop-web' }): Promise<string> {
    const response = await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions`, payload })
    expect(response.statusCode).toBe(201)
    return sessionCreatedSchema.parse(response.json()).session.id
  }

  /** Streaming is the default response. */
  async function streamMessage(ses: string, text: string, headers: Record<string, string> = {}) {
    const response = await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions/${ses}/messages`, headers,
      payload: { message: { parts: [{ type: 'text', text }] } } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    return parseSse(response.body)
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

  it('streams a run with text deltas and reports the same objects in history', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN })
    const ses = await createSession()
    const events = await streamMessage(ses, 'Say hello')
    for (const { data } of events) expect(agentApiEventSchema.safeParse(data).error?.issues ?? []).toEqual([])
    // The stream closes after this run's run.completed; the idle status follows in the log.
    expect(events.map(({ event }) => event)).toEqual([
      'session.status_changed', 'run.started', 'run.updated', 'item.started', 'item.delta', 'item.delta',
      'item.completed', 'run.completed',
    ])
    expect(events.filter((event) => event.id !== undefined).map(({ id }) => Number(id))).toEqual([1, 2, 3, 4, 5, 6])
    await idle(ses)
    const durable = await durableLog(ses)
    expect(durable.map((event) => event.seq)).toEqual(durable.map((_event, index) => index + 1))
    expect(events.filter(({ event }) => event === 'item.delta').map(({ data }) => (data['delta'] as { text: string }).text)).toEqual(['Hel', 'lo'])
    const started = durable.find((event) => event.type === 'run.started')
    expect(started?.type === 'run.started' && started.run.input).toMatchObject({ type: 'user_message', source: 'api', content: [{ type: 'text', text: 'Say hello' }] })
    const completed = durable.find((event) => event.type === 'run.completed')
    expect(completed?.type === 'run.completed' && completed.run).toMatchObject({
      status: 'completed', stop_reason: 'end_turn', output_text: 'Hello', model: 'claude-sonnet-4-5', duration_ms: 1200,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 2, cost_usd: 0.01 },
    })
    expect(durable.at(-1)).toMatchObject({ type: 'session.status_changed', status: { state: 'idle', stop_reason: 'end_turn' } })

    const replayed = applyEvents(durable)
    const history = runsPageSchema.parse((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${ses}/runs` })).json())
    expect(history.data).toEqual([...replayed.runs.values()].map((run) => ({ ...run, items: replayed.items.get(run.id) ?? [] })))
    expect(history.data[0]?.items).toEqual([expect.objectContaining({ type: 'message', status: 'completed', content: [{ type: 'text', text: 'Hello' }] })])
    const snapshot = sessionSnapshotSchema.parse((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${ses}` })).json())
    expect(snapshot).toMatchObject({ status: replayed.status, last_event_seq: durable.length, active_run: null, driver: 'sdk' })
  })

  it('maps reasoning and a failed command with argument deltas', async () => {
    fixture = await createAgentApiFixture({ claude: TOOL_RUN })
    const ses = await createSession()
    const events = await streamMessage(ses, 'Run the tests')
    const durable = events.filter((event) => event.id !== undefined).map(({ data }) => data as DurableEvent)
    const toolEvents = durable.filter((event) => 'item' in event && event.item.type === 'tool_call').map((event) => 'item' in event ? [event.type, event.item.status, 'input' in event.item] : [])
    expect(toolEvents).toEqual([['item.started', 'pending', false], ['item.updated', 'running', true], ['item.completed', 'failed', true]])
    const tool = durable.find((event) => event.type === 'item.completed' && event.item.type === 'tool_call')
    expect(tool?.type === 'item.completed' && tool.item).toMatchObject({
      tool: { name: 'Bash', kind: 'command' }, input: { command: 'npm test' }, output: { content: [{ type: 'text', text: '1 failed' }], is_error: true }, duration_ms: 80,
    })
    expect(events.filter(({ event }) => event === 'item.delta').map(({ data }) => data['delta'])).toEqual([
      { type: 'text', text: 'Check the tests' },
      { type: 'input_json', text: '{"command":"npm test"}' },
      { type: 'text', index: 0, text: 'One test fails.' },
    ])
    const history = runsPageSchema.parse((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${ses}/runs` })).json())
    expect(history.data[0]?.items.map((item) => [item.type, item.status])).toEqual([['reasoning', 'completed'], ['tool_call', 'failed'], ['message', 'completed']])
  })

  it('turns inline and referenced parts into the turn the provider receives', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN })
    const vision = await fixture.modelProfiles.createProfile({ label: 'Vision', baseUrl: 'https://api.example.com/v1', authToken: 'secret',
      defaultModel: 'vision-model', modelCapabilities: { imageUnderstanding: ['vision-model'], imageGeneration: [], imageEdit: [], classification: [] } })
    const ses = await createSession({ workdir: 'projects/shop-web', settings: { model: `${vision.id}:vision-model` } })
    await writeFile(join(fixture.workspace, 'projects', 'shop-web', 'error.log'), 'boom')
    const response = await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions/${ses}/messages`, payload: { message: { parts: [
      { type: 'text', text: 'Look' },
      { type: 'image', image_url: `data:image/png;base64,${Buffer.from('png').toString('base64')}` },
      { type: 'file', file_path: 'error.log' },
      { type: 'file', file_data: `data:text/plain;base64,${Buffer.from('notes').toString('base64')}`, filename: 'notes.txt' },
    ] }, response: 'accepted' } })
    expect(response.statusCode).toBe(202)
    expect(messageAcceptedSchema.parse(response.json())).toMatchObject({ run: { status: 'in_progress' }, last_event_seq: 0 })
    await idle(ses)
    const turn = fixture.claude.turns[0]
    expect(turn?.text).toBe('Look')
    expect(turn?.attachments?.map((file) => file.name)).toEqual(['error.log', 'notes.txt'])
    expect(await readFile(turn?.imagePaths?.[0] ?? '', 'utf8')).toBe('png')
    expect(userTurnText(turn ?? { text: '' })).toContain('<priva-attachments>')
    const history = runsPageSchema.parse((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${ses}/runs` })).json())
    expect(history.data[0]?.input).toMatchObject({ content: [
      { type: 'image', image_path: expect.stringMatching(/^\.priva-attachments\/file-[^/]+\/image-1\.png$/u) as string, media_type: 'image/png' },
      { type: 'text', text: 'Look' },
      { type: 'file', file_path: 'error.log', name: 'error.log', media_type: 'text/plain', size: 4 },
      { type: 'file', name: 'notes.txt', size: 5 },
    ] })
  })

  it.each([
    ['an image for a model without image input', [{ type: 'text', text: 'x' }, { type: 'image', image_url: 'data:image/png;base64,AAAA' }], 422, 'image_input_unsupported', 'message.parts[1]'],
    ['a file outside the session directory', [{ type: 'file', file_path: '../../runtime/x' }], 422, 'path_outside_workspace', 'message.parts[0].file_path'],
    ['a missing file', [{ type: 'file', file_path: 'missing.txt' }], 422, 'validation_failed', 'message.parts[0].file_path'],
    ['an empty message', [{ type: 'text', text: ' ' }], 422, 'validation_failed', 'message'],
  ])('rejects %s', async (_name, parts, status, code, param) => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN })
    const ses = await createSession()
    const response = await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions/${ses}/messages`, payload: { message: { parts } } })
    expect(response.statusCode).toBe(status)
    expect(response.json()).toMatchObject({ error: { code, param } })
    expect(fixture.claude.turns).toEqual([])
  })

  it('refuses to write while the session runs or a terminal drives it', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN })
    let release!: () => void
    fixture.claude.gate = new Promise((resolve) => { release = resolve })
    const ses = await createSession()
    const send = (text: string) => fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions/${ses}/messages`,
      payload: { message: { parts: [{ type: 'text', text }] }, response: 'accepted' } })
    expect((await send('first')).statusCode).toBe(202)
    const busy = await send('second')
    expect(busy.statusCode).toBe(409)
    expect(busy.json()).toMatchObject({ error: { type: 'conflict', code: 'session_busy' } })
    release()
    await idle(ses)
    vi.spyOn(fixture.harness, 'sessionActivity').mockResolvedValue({ driver: 'terminal', running: false })
    expect((await send('third')).json()).toMatchObject({ error: { code: 'session_driven_by_terminal' } })
  })

  it('returns the first result for a repeated Idempotency-Key', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN })
    const ses = await createSession()
    const send = (text: string) => fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions/${ses}/messages`,
      headers: { 'idempotency-key': 'key-1' }, payload: { message: { parts: [{ type: 'text', text }] }, response: 'accepted' } })
    const first = await send('hello')
    await idle(ses)
    const again = await send('hello')
    expect(again.statusCode).toBe(202)
    expect(again.json()).toEqual(first.json())
    expect(fixture.claude.turns).toHaveLength(1)
    expect((await send('different')).json()).toMatchObject({ error: { code: 'idempotency_conflict' } })
  })

  it('replays durable events after a cursor and resyncs an in-progress item', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN.slice(0, 3) })
    let finish!: () => void
    fixture.claude.afterEventsGate = new Promise((resolve) => { finish = resolve })
    const ses = await createSession()
    await fixture.server.inject({ method: 'POST', url: `${AGENT_API}/sessions/${ses}/messages`, payload: { message: { parts: [{ type: 'text', text: 'hi' }] }, response: 'accepted' } })
    await expect.poll(() => fixture.claude.turns.length).toBe(1)
    const address = await fixture.server.listen({ port: 0, host: '127.0.0.1' })
    const read = async (query: string, headers: Record<string, string> = {}) => {
      const controller = new AbortController()
      const response = await fetch(`${address}${AGENT_API}/sessions/${ses}/events${query}`, { headers, signal: controller.signal })
      return { response, controller }
    }

    const { response, controller } = await read('?after=2')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('Expected an event stream body')
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('"resync":true')) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value as Uint8Array, { stream: true })
    }
    controller.abort()
    const events = parseSse(text)
    expect(events.map(({ event, id }) => [event, id])).toEqual([['run.updated', '3'], ['item.started', '4'], ['item.updated', undefined]])
    expect(events.at(-1)?.data).toMatchObject({ resync: true, item: { type: 'message', status: 'in_progress', content: [{ type: 'text', text: 'Hello' }] } })

    expect((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${ses}/events?after=99` })).json()).toMatchObject({ error: { code: 'cursor_invalid' } })
    expect((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${ses}/events?after=1`, headers: { 'last-event-id': '2' } })).statusCode).toBe(400)
    finish()
    await idle(ses)
  })

  it('binds a new Pi session to the native session its first run opens', async () => {
    fixture = await createAgentApiFixture({ pi: [{ type: 'run.completed', model: 'pi-model', durationMs: 1 }] })
    const ses = await createSession({ harness: 'pi' })
    const events = await streamMessage(ses, 'hello pi')
    expect(events.map(({ event }) => event)).toEqual(['session.status_changed', 'run.started', 'run.updated', 'run.completed'])
    expect(events.at(-1)?.data).toMatchObject({ run: { status: 'completed', model: 'claude-sonnet-4-5', duration_ms: 1 } })
    await idle(ses)
    const stored = async () => (JSON.parse(await readFile(join(fixture.runtimeHome, 'agent-api', 'sessions', ses, 'session.json'), 'utf8')) as { nativeId: string | null }).nativeId
    await expect.poll(stored).toBe('session-1')
  })

  it('completes a run that fails before the provider starts it', async () => {
    fixture = await createAgentApiFixture({ claude: TEXT_RUN })
    vi.spyOn(fixture.claude, 'openSession').mockRejectedValue(new Error('cannot start'))
    const ses = await createSession()
    const events = await streamMessage(ses, 'hi')
    expect(events.map(({ event }) => event)).toEqual(['session.status_changed', 'run.started', 'run.completed'])
    const completed = events.at(-1)?.data as { run: Run } | undefined
    expect(completed?.run).toMatchObject({ status: 'failed', stop_reason: 'error', error: { message: 'cannot start' } })
    const snapshot = sessionSnapshotSchema.parse((await fixture.server.inject({ method: 'GET', url: `${AGENT_API}/sessions/${ses}` })).json())
    expect(snapshot.status).toEqual({ state: 'idle', stop_reason: 'error', active_tasks: 0 })
  })
})

/** Apply durable events in order, as a client following the stream would. */
function applyEvents(events: readonly DurableEvent[]) {
  const runs = new Map<string, Run>()
  const items = new Map<string, Item[]>()
  let status: unknown
  for (const event of events) {
    if (event.type === 'session.status_changed') status = event.status
    if ('run' in event) runs.set(event.run.id, event.run)
    if ('item' in event && event.run_id !== undefined) {
      const list = items.get(event.run_id) ?? []
      const index = list.findIndex((item) => item.id === event.item.id)
      items.set(event.run_id, index < 0 ? [...list, event.item] : list.map((item, position) => position === index ? event.item : item))
    }
  }
  return { runs, items, status }
}
