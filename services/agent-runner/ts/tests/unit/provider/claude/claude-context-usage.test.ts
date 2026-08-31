import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { emptyContextUsage } from '../../../../src/core/resource/context-usage.js'
import {
  measureClaudeContextUsage,
  resolveClaudeContextQueryOptions,
  type ClaudeContextQuery,
} from '../../../../src/provider/claude/claude-context-usage.js'
import { testRunSpec } from '../../../support/run-spec.js'

describe('measureClaudeContextUsage', () => {
  it('resumes the session without persisting, then closes the query', async () => {
    const spec = testRunSpec({ cwd: '/work/repo' })
    const options = resolveClaudeContextQueryOptions(spec, 'sess-cold', '/cfg/.claude')
    expect(options.resume).toBe('sess-cold')
    expect(options.persistSession).toBe(false)
    expect(options.tools).toBeUndefined()

    const started: Options[] = []
    const query = new FakeClaudeContextQuery()
    const usage = await measureClaudeContextUsage({
      spec,
      sessionId: 'sess-cold',
      globalConfigDir: '/cfg/.claude',
      startQuery: ({ prompt, options: next }) => {
        started.push(next)
        query.bind(prompt)
        return query
      },
    })

    expect(usage).toEqual({
      used: 20,
      limit: 200,
      categories: emptyContextUsage().categories.map((category) => {
        if (category.id === 'systemPrompt') return { ...category, tokens: 5 }
        if (category.id === 'toolDefinitions') return { ...category, tokens: 10 }
        if (category.id === 'conversation') return { ...category, tokens: 5 }
        return category
      }),
    })
    expect(started).toHaveLength(1)
    expect(started[0]?.resume).toBe('sess-cold')
    expect(started[0]?.persistSession).toBe(false)
    expect(query.initialized).toBe(true)
    expect(query.closed).toBe(true)
    expect(query.aborted).toBe(true)
  })

  it('returns an empty snapshot when the query fails to initialize', async () => {
    const usage = await measureClaudeContextUsage({
      spec: testRunSpec(),
      sessionId: 'sess-missing',
      globalConfigDir: '/cfg/.claude',
      startQuery: ({ prompt }) => new FakeClaudeContextQuery(prompt, { failInit: true }),
    })
    expect(usage).toEqual(emptyContextUsage())
  })
})

class FakeClaudeContextQuery implements ClaudeContextQuery {
  initialized = false
  closed = false
  aborted = false
  private prompt: AsyncIterable<SDKUserMessage> | undefined

  constructor(
    prompt?: AsyncIterable<SDKUserMessage>,
    private readonly flags: { readonly failInit?: boolean } = {},
  ) {
    this.prompt = prompt
  }

  bind(prompt: AsyncIterable<SDKUserMessage>): void {
    this.prompt = prompt
  }

  initializationResult(): ReturnType<Query['initializationResult']> {
    this.initialized = true
    if (this.flags.failInit === true) {
      return Promise.reject(new Error('init failed'))
    }
    return Promise.resolve({} as Awaited<ReturnType<Query['initializationResult']>>)
  }

  getContextUsage(): ReturnType<Query['getContextUsage']> {
    return Promise.resolve({
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
  }

  close(): void {
    this.closed = true
    this.aborted = true
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    if (this.prompt === undefined) {
      return {
        next: () => Promise.resolve({ done: true, value: undefined }),
      }
    }
    return this.prompt[Symbol.asyncIterator]() as AsyncIterator<SDKMessage>
  }
}
