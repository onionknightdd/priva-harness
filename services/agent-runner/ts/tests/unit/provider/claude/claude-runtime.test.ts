import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { consumeRunEvents } from '../../../../src/harness/run/consume-run-events.js'
import {
  ClaudeRuntime,
  type ClaudeQuery,
} from '../../../../src/provider/claude/claude-runtime.js'
import { testRunSpec } from '../../../support/run-spec.js'

describe('ClaudeRuntime stream input', () => {
  it('keeps the prompt iterable open after the first turn until release', async () => {
    let query: FakeClaudeQuery | undefined
    let started = 0
    const runtime = new ClaudeRuntime(
      testRunSpec(),
      { kind: 'new', provider: 'claude' },
      '/tmp/claude',
      ({ prompt }) => {
        started += 1
        query = new FakeClaudeQuery(prompt)
        return query
      },
    )

    const first = await collect(runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    ))
    expect(first).toEqual([
      expect.objectContaining({
        type: 'run.completed',
        sessionId: 'sess-stream',
      }),
    ])
    await query?.turnReady
    expect(query?.waitingForMore).toBe(true)
    expect(userTexts(query?.received)).toEqual(['hello'])
    expect(started).toBe(1)

    const second = await collect(runtime.run(
      { text: 'again' },
      { signal: new AbortController().signal },
    ))
    expect(second).toEqual([
      expect.objectContaining({
        type: 'run.completed',
        sessionId: 'sess-stream',
      }),
    ])
    expect(userTexts(query?.received)).toEqual(['hello', 'again'])
    expect(started).toBe(1)
    expect(query?.waitingForMore).toBe(true)

    await runtime.release('dispose')
    await query?.promptEnded
    expect(query?.waitingForMore).toBe(false)
  })
})

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = []
  for await (const event of consumeRunEvents(events)) collected.push(event)
  return collected
}

function userTexts(messages: readonly SDKUserMessage[] | undefined): string[] {
  if (messages === undefined) return []
  return messages.map((message) => {
    const content = message.message.content
    return typeof content === 'string' ? content : ''
  })
}

class FakeClaudeQuery implements ClaudeQuery {
  waitingForMore = false
  readonly received: SDKUserMessage[] = []
  readonly turnReady: Promise<void>
  readonly promptEnded: Promise<void>
  readonly interrupt = (): Promise<undefined> => Promise.resolve(undefined)
  readonly close = (): void => undefined

  private readonly resolveTurnReady: () => void
  private readonly resolvePromptEnded: () => void

  constructor(private readonly prompt: AsyncIterable<SDKUserMessage>) {
    let resolveTurnReady = (): void => undefined
    let resolvePromptEnded = (): void => undefined
    this.turnReady = new Promise((resolve) => {
      resolveTurnReady = resolve
    })
    this.promptEnded = new Promise((resolve) => {
      resolvePromptEnded = resolve
    })
    this.resolveTurnReady = resolveTurnReady
    this.resolvePromptEnded = resolvePromptEnded
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
    for await (const message of this.prompt) {
      this.received.push(message)
      this.waitingForMore = false
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 'sess-stream',
        duration_ms: 1,
      } as SDKMessage
      this.waitingForMore = true
      this.resolveTurnReady()
    }
    this.waitingForMore = false
    this.resolvePromptEnded()
  }
}
