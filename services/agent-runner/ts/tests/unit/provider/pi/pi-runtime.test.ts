import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { consumeRunEvents } from '../../../../src/harness/run/consume-run-events.js'
import { PiRuntime, type PiAgentSession } from '../../../../src/provider/pi/pi-runtime.js'
import type { PiSessionEvent } from '../../../../src/provider/pi/pi-event-mapper.js'
import { testRunSpec } from '../../../support/run-spec.js'

describe('PiRuntime stream input', () => {
  it('keeps the session subscription open until release and sends with prompt when idle', async () => {
    const session = new FakePiAgentSession()
    const runtime = new PiRuntime(session)

    const events: AgentEvent[] = []
    for await (const event of consumeRunEvents(runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    ))) {
      events.push(event)
    }

    expect(session.prompts).toEqual(['hello'])
    expect(session.followUps).toEqual([])
    expect(session.unsubscribed).toBe(0)
    expect(events).toEqual([
      expect.objectContaining({
        type: 'run.completed',
        sessionId: 'pi-1',
      }),
    ])

    const second: AgentEvent[] = []
    for await (const event of consumeRunEvents(runtime.run(
      { text: 'again' },
      { signal: new AbortController().signal },
    ))) {
      second.push(event)
    }
    expect(session.prompts).toEqual(['hello', 'again'])
    expect(session.unsubscribed).toBe(0)
    expect(second).toEqual([
      expect.objectContaining({
        type: 'run.completed',
        sessionId: 'pi-1',
      }),
    ])

    await runtime.release('dispose')
    expect(session.unsubscribed).toBe(1)
    expect(session.disposed).toBe(true)
  })

  it('keeps the session on warm release', async () => {
    const session = new FakePiAgentSession()
    const runtime = new PiRuntime(session)
    for await (const event of consumeRunEvents(runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    ))) {
      void event
    }
    await runtime.release('warm')
    expect(session.unsubscribed).toBe(0)
    expect(session.disposed).toBe(false)
    await runtime.release('dispose')
    expect(session.disposed).toBe(true)
  })

  it('sends follow-up on the live session when already streaming', async () => {
    const session = new FakePiAgentSession()
    session.streaming = true
    const runtime = new PiRuntime(session)

    const later: AgentEvent[] = []
    for await (const event of consumeRunEvents(runtime.run(
      { text: 'later' },
      { signal: new AbortController().signal },
    ))) {
      later.push(event)
    }
    expect(later.length).toBeGreaterThan(0)

    expect(session.prompts).toEqual([])
    expect(session.followUps).toEqual(['later'])
    await runtime.release('dispose')
  })

  it('steers a live session when queue behavior is steer', async () => {
    const session = new FakePiAgentSession()
    session.streaming = true
    const runtime = new PiRuntime(session, 'steer')

    for await (const _event of consumeRunEvents(runtime.run(
      { text: 'nudge' },
      { signal: new AbortController().signal },
    ))) {
      void _event
    }

    expect(session.steers).toEqual(['nudge'])
    expect(session.followUps).toEqual([])
    expect(session.prompts).toEqual([])
    await runtime.release('dispose')
  })

  it('aborts then prompts a live session when queue behavior is interrupt', async () => {
    const session = new FakePiAgentSession()
    session.streaming = true
    const runtime = new PiRuntime(session, 'interrupt')

    for await (const _event of consumeRunEvents(runtime.run(
      { text: 'cut in' },
      { signal: new AbortController().signal },
    ))) {
      void _event
    }

    expect(session.aborts).toBe(1)
    expect(session.prompts).toEqual(['cut in'])
    expect(session.followUps).toEqual([])
    await runtime.release('dispose')
  })

  it('applies a new model on the live session', async () => {
    const session = new FakePiAgentSession()
    const runtime = new PiRuntime(session)
    await runtime.applyRunSpec(testRunSpec({ provider: 'pi', model: 'm2' }))
    expect(session.modelId).toBe('m2')
    expect(session.models).toEqual(['m2'])
    await runtime.release('dispose')
  })

  it('dispatches /compact to session.compact instead of prompt', async () => {
    const session = new FakePiAgentSession()
    const runtime = new PiRuntime(session)
    const events: AgentEvent[] = []
    for await (const event of consumeRunEvents(runtime.run(
      { text: '/compact keep the tokens' },
      { signal: new AbortController().signal },
    ))) {
      events.push(event)
    }
    expect(session.prompts).toEqual([])
    expect(session.compacts).toEqual(['keep the tokens'])
    expect(events).toEqual([
      { type: 'session.compacting' },
      { type: 'session.compacted', summary: 'Kept the tokens.' },
      expect.objectContaining({ type: 'run.completed', sessionId: 'pi-1' }),
    ])
    await runtime.release('dispose')
  })

  it('throws when the session cannot change model in place', async () => {
    const session = new FakePiAgentSession()
    Reflect.deleteProperty(session, 'setRunModel')
    const runtime = new PiRuntime(session)
    await expect(runtime.applyRunSpec(testRunSpec({ provider: 'pi', model: 'm2' })))
      .rejects.toThrow('Pi session cannot change model in place')
    await runtime.release('dispose')
  })

  it('maps session context usage without inventing categories', async () => {
    const session = new FakePiAgentSession()
    session.contextUsage = { tokens: 1844, contextWindow: 1_000_000 }
    const runtime = new PiRuntime(session)
    expect(await runtime.getContextUsage()).toEqual({
      used: 1844,
      limit: 1_000_000,
      categories: [
        { id: 'systemPrompt', tokens: null },
        { id: 'toolDefinitions', tokens: null },
        { id: 'skills', tokens: null },
        { id: 'mcpTools', tokens: null },
        { id: 'subagentDefinitions', tokens: null },
        { id: 'memory', tokens: null },
        { id: 'conversation', tokens: null },
      ],
    })
    await runtime.release('dispose')
    expect(await runtime.getContextUsage()).toEqual({
      used: null,
      limit: null,
      categories: [
        { id: 'systemPrompt', tokens: null },
        { id: 'toolDefinitions', tokens: null },
        { id: 'skills', tokens: null },
        { id: 'mcpTools', tokens: null },
        { id: 'subagentDefinitions', tokens: null },
        { id: 'memory', tokens: null },
        { id: 'conversation', tokens: null },
      ],
    })
  })
})

class FakePiAgentSession implements PiAgentSession {
  readonly sessionId = 'pi-1'
  modelId = 'm'
  readonly models: string[] = []
  streaming = false
  unsubscribed = 0
  disposed = false
  readonly prompts: string[] = []
  readonly followUps: string[] = []
  readonly steers: string[] = []
  readonly compacts: string[] = []
  aborts = 0
  contextUsage: { tokens: number | null; contextWindow: number } | undefined
  private listener: ((event: PiSessionEvent) => void) | undefined

  get isStreaming(): boolean {
    return this.streaming
  }

  subscribe(listener: (event: PiSessionEvent) => void): () => void {
    this.listener = listener
    return () => {
      this.unsubscribed += 1
      this.listener = undefined
    }
  }

  prompt(text: string): Promise<void> {
    this.prompts.push(text)
    this.listener?.({
      type: 'agent_end',
      messages: [{ role: 'assistant', model: this.modelId, content: [{ type: 'text', text: 'ok' }] }],
    })
    return Promise.resolve()
  }

  followUp(text: string): Promise<void> {
    this.followUps.push(text)
    this.listener?.({
      type: 'agent_end',
      messages: [{ role: 'assistant', model: this.modelId, content: [{ type: 'text', text: 'ok' }] }],
    })
    return Promise.resolve()
  }

  steer(text: string): Promise<void> {
    this.steers.push(text)
    this.listener?.({
      type: 'agent_end',
      messages: [{ role: 'assistant', model: this.modelId, content: [{ type: 'text', text: 'ok' }] }],
    })
    return Promise.resolve()
  }

  compact(customInstructions?: string): Promise<void> {
    this.compacts.push(customInstructions ?? '')
    this.listener?.({ type: 'compaction_start', reason: 'manual' })
    this.listener?.({
      type: 'compaction_end',
      reason: 'manual',
      result: { summary: 'Kept the tokens.' },
      aborted: false,
    })
    return Promise.resolve()
  }

  abort(): Promise<void> {
    this.aborts += 1
    return Promise.resolve()
  }

  getContextUsage(): { tokens: number | null; contextWindow: number } | undefined {
    return this.contextUsage
  }

  setRunModel?: (modelId: string) => Promise<void> = (modelId) => {
    this.models.push(modelId)
    this.modelId = modelId
    return Promise.resolve()
  }

  dispose(): void {
    this.disposed = true
  }
}
