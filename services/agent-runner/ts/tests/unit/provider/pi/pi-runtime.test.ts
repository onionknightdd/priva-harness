import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { PiRuntime, type PiAgentSession } from '../../../../src/provider/pi/pi-runtime.js'
import type { PiSessionEvent } from '../../../../src/provider/pi/pi-event-mapper.js'

describe('PiRuntime stream input', () => {
  it('keeps the session subscription open until release and sends with prompt when idle', async () => {
    const session = new FakePiAgentSession()
    const runtime = new PiRuntime(session)

    const events: AgentEvent[] = []
    for await (const event of runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    )) {
      events.push(event)
    }

    expect(session.prompts).toEqual(['hello'])
    expect(session.followUps).toEqual([])
    expect(session.unsubscribed).toBe(0)
    expect(events).toEqual([
      expect.objectContaining({
        type: 'run',
        event: 'completed',
        sessionId: 'pi-1',
      }),
    ])

    const second: AgentEvent[] = []
    for await (const event of runtime.run(
      { text: 'again' },
      { signal: new AbortController().signal },
    )) {
      second.push(event)
    }
    expect(session.prompts).toEqual(['hello', 'again'])
    expect(session.unsubscribed).toBe(0)
    expect(second).toEqual([
      expect.objectContaining({
        type: 'run',
        event: 'completed',
        sessionId: 'pi-1',
      }),
    ])

    await runtime.release('dispose')
    expect(session.unsubscribed).toBe(1)
    expect(session.disposed).toBe(true)
  })

  it('sends follow-up on the live session when already streaming', async () => {
    const session = new FakePiAgentSession()
    session.streaming = true
    const runtime = new PiRuntime(session)

    const later: AgentEvent[] = []
    for await (const event of runtime.run(
      { text: 'later' },
      { signal: new AbortController().signal },
    )) {
      later.push(event)
    }
    expect(later.length).toBeGreaterThan(0)

    expect(session.prompts).toEqual([])
    expect(session.followUps).toEqual(['later'])
    await runtime.release('dispose')
  })
})

class FakePiAgentSession implements PiAgentSession {
  readonly sessionId = 'pi-1'
  readonly modelId = 'm'
  streaming = false
  unsubscribed = 0
  disposed = false
  readonly prompts: string[] = []
  readonly followUps: string[] = []
  readonly steers: string[] = []
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
    return Promise.resolve()
  }

  abort(): Promise<void> {
    return Promise.resolve()
  }

  dispose(): void {
    this.disposed = true
  }
}
