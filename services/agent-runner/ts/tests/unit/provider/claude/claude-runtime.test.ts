import type { SDKControlGetContextUsageResponse, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { consumeRunEvents } from '../../../../src/harness/run/consume-run-events.js'
import { emptyContextUsage } from '../../../../src/core/resource/context-usage.js'
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

  it('keeps the query open on warm release', async () => {
    let query: FakeClaudeQuery | undefined
    const runtime = new ClaudeRuntime(
      testRunSpec(),
      { kind: 'new', provider: 'claude' },
      '/tmp/claude',
      ({ prompt }) => {
        query = new FakeClaudeQuery(prompt)
        return query
      },
    )
    await collect(runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    ))
    await query?.turnReady
    await runtime.release('warm')
    expect(query?.waitingForMore).toBe(true)
    await runtime.release('dispose')
    await query?.promptEnded
    expect(query?.waitingForMore).toBe(false)
  })

  it('switches the warm query model without starting a new query', async () => {
    let query: FakeClaudeQuery | undefined
    let started = 0
    const runtime = new ClaudeRuntime(
      testRunSpec({ model: 'm1' }),
      { kind: 'new', provider: 'claude' },
      '/tmp/claude',
      ({ prompt }) => {
        started += 1
        query = new FakeClaudeQuery(prompt)
        return query
      },
    )

    await collect(runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    ))
    await query?.turnReady
    await runtime.applyRunSpec(testRunSpec({ model: 'm2' }))
    expect(query?.models).toEqual(['m2'])

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
    await runtime.release('dispose')
  })

  it('reads context usage from the live query after a turn', async () => {
    let query: FakeClaudeQuery | undefined
    const runtime = new ClaudeRuntime(
      testRunSpec(),
      { kind: 'new', provider: 'claude' },
      '/tmp/claude',
      ({ prompt }) => {
        query = new FakeClaudeQuery(prompt)
        return query
      },
    )
    expect(await runtime.getContextUsage()).toEqual(emptyContextUsage())
    await collect(runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    ))
    await query?.turnReady
    expect(await runtime.getContextUsage()).toEqual({
      used: 20,
      limit: 200,
      categories: [
        { id: 'systemPrompt', tokens: 5 },
        { id: 'toolDefinitions', tokens: 10 },
        { id: 'skills', tokens: null },
        { id: 'mcpTools', tokens: null },
        { id: 'subagentDefinitions', tokens: null },
        { id: 'memory', tokens: null },
        { id: 'conversation', tokens: 5 },
      ],
    })
    await runtime.release('dispose')
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
  readonly models: string[] = []
  readonly interrupt = (): Promise<undefined> => Promise.resolve(undefined)
  readonly close = (): void => undefined
  readonly setModel = (model?: string): Promise<void> => {
    this.models.push(model ?? '')
    return Promise.resolve()
  }
  readonly getContextUsage = (): Promise<SDKControlGetContextUsageResponse> => Promise.resolve({
    categories: [
      { name: 'System prompt', tokens: 5, color: '' },
      { name: 'System tools', tokens: 10, color: '' },
      { name: 'Messages', tokens: 5, color: '' },
    ],
    totalTokens: 20,
    maxTokens: 200,
    rawMaxTokens: 200,
    percentage: 10,
    gridRows: [],
    model: 'm',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: true,
    apiUsage: null,
  })

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
