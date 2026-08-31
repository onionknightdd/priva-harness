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

  it('waits for configured MCP servers before reading tool categories', async () => {
    const query = new FakeClaudeContextQuery(undefined, {
      mcp: [
        [],
        [{ name: 'agentWorkshop', status: 'connected' }],
      ],
      usage: [
        contextSnapshot([
          { name: 'System prompt', tokens: 5 },
          { name: 'System tools', tokens: 10 },
          { name: 'Messages', tokens: 44 },
        ]),
        contextSnapshot([
          { name: 'System prompt', tokens: 5 },
          { name: 'System tools', tokens: 10 },
          { name: 'MCP tools', tokens: 862 },
          { name: 'Messages', tokens: 44 },
        ]),
      ],
    })
    const usage = await measureClaudeContextUsage({
      spec: testRunSpec(),
      sessionId: 'sess-cold',
      globalConfigDir: '/cfg/.claude',
      tools: [stubProductTool],
      startQuery: ({ prompt }) => {
        query.bind(prompt)
        return query
      },
    })

    expect(query.mcpStatusCalls).toBe(2)
    expect(query.usageCalls).toBe(2)
    expect(usage).toEqual({
      used: 921,
      limit: 200,
      categories: emptyContextUsage().categories.map((category) => {
        if (category.id === 'systemPrompt') return { ...category, tokens: 5 }
        if (category.id === 'toolDefinitions') return { ...category, tokens: 10 }
        if (category.id === 'mcpTools') return { ...category, tokens: 862 }
        if (category.id === 'conversation') return { ...category, tokens: 44 }
        return category
      }),
    })
  })

  it('keeps the first snapshot when MCP status never settles', async () => {
    const query = new FakeClaudeContextQuery(undefined, { hangMcp: true })
    const usage = await measureClaudeContextUsage({
      spec: testRunSpec(),
      sessionId: 'sess-cold',
      globalConfigDir: '/cfg/.claude',
      tools: [stubProductTool],
      startQuery: ({ prompt }) => {
        query.bind(prompt)
        return query
      },
    })

    expect(query.usageCalls).toBe(1)
    expect(usage.categories).toEqual(emptyContextUsage().categories.map((category) => {
      if (category.id === 'systemPrompt') return { ...category, tokens: 5 }
      if (category.id === 'toolDefinitions') return { ...category, tokens: 10 }
      if (category.id === 'conversation') return { ...category, tokens: 5 }
      return category
    }))
  })

  it('keeps the first snapshot when the second usage read fails', async () => {
    const query = new FakeClaudeContextQuery(undefined, {
      mcp: [[{ name: 'agentWorkshop', status: 'connected' }]],
      failSecondUsage: true,
    })
    const usage = await measureClaudeContextUsage({
      spec: testRunSpec(),
      sessionId: 'sess-cold',
      globalConfigDir: '/cfg/.claude',
      tools: [stubProductTool],
      startQuery: ({ prompt }) => {
        query.bind(prompt)
        return query
      },
    })

    expect(query.usageCalls).toBe(2)
    expect(usage.categories.find((category) => category.id === 'systemPrompt')?.tokens).toBe(5)
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

const stubProductTool = {
  name: 'visualize',
  description: 'test',
  inputSchema: { type: 'object' as const, properties: {} },
  execute: () => Promise.resolve({ ok: true, text: '' }),
}

function contextSnapshot(
  categories: { name: string; tokens: number }[],
): Awaited<ReturnType<Query['getContextUsage']>> {
  return {
    categories: categories.map((row) => ({ ...row, color: '' })),
    totalTokens: categories.reduce((sum, row) => sum + row.tokens, 0),
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
  }
}

class FakeClaudeContextQuery implements ClaudeContextQuery {
  initialized = false
  closed = false
  aborted = false
  mcpStatusCalls = 0
  usageCalls = 0
  private prompt: AsyncIterable<SDKUserMessage> | undefined
  private readonly mcp: { name: string; status: 'connected' | 'pending' }[][]
  private readonly usage: Awaited<ReturnType<Query['getContextUsage']>>[]

  constructor(
    prompt?: AsyncIterable<SDKUserMessage>,
    private readonly flags: {
      readonly failInit?: boolean
      readonly hangMcp?: boolean
      readonly failSecondUsage?: boolean
      readonly mcp?: { name: string; status: 'connected' | 'pending' }[][]
      readonly usage?: Awaited<ReturnType<Query['getContextUsage']>>[]
    } = {},
  ) {
    this.prompt = prompt
    this.mcp = flags.mcp ?? []
    this.usage = flags.usage ?? [contextSnapshot([
      { name: 'System prompt', tokens: 5 },
      { name: 'System tools', tokens: 10 },
      { name: 'Messages', tokens: 5 },
    ])]
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

  mcpServerStatus(): ReturnType<Query['mcpServerStatus']> {
    if (this.flags.hangMcp === true) {
      return new Promise(() => undefined)
    }
    const snapshot = this.mcp[Math.min(this.mcpStatusCalls, Math.max(this.mcp.length - 1, 0))]
    this.mcpStatusCalls += 1
    return Promise.resolve((snapshot ?? []) as Awaited<ReturnType<Query['mcpServerStatus']>>)
  }

  getContextUsage(): ReturnType<Query['getContextUsage']> {
    this.usageCalls += 1
    if (this.flags.failSecondUsage === true && this.usageCalls === 2) {
      return Promise.reject(new Error('usage failed'))
    }
    const snapshot = this.usage[Math.min(this.usageCalls - 1, this.usage.length - 1)]
    if (snapshot === undefined) {
      return Promise.reject(new Error('missing usage snapshot'))
    }
    return Promise.resolve(snapshot)
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
