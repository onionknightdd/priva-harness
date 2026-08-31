import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { emptyContextUsage } from '../../../../src/core/resource/context-usage.js'
import type { ToolDefinition } from '../../../../src/core/tool/define-tool.js'
import {
  measureClaudeContextUsage,
  resolveClaudeContextQueryOptions,
  type ClaudeContextQuery,
} from '../../../../src/provider/claude/claude-context-usage.js'
import { testRunSpec } from '../../../support/run-spec.js'

const probeTool: ToolDefinition = {
  name: 'probe',
  description: 'probe tool',
  inputSchema: { type: 'object', properties: {} },
  execute: () => Promise.resolve({ ok: true, text: 'ok' }),
}

describe('measureClaudeContextUsage', () => {
  it('resumes the session without persisting, then closes the query', async () => {
    const spec = testRunSpec({ cwd: '/work/repo' })
    const options = resolveClaudeContextQueryOptions(spec, 'sess-cold', '/cfg/.claude')
    expect(options.resume).toBe('sess-cold')
    expect(options.persistSession).toBe(false)
    expect(options.mcpServers).toBeUndefined()
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
    expect(started[0]?.mcpServers).toBeUndefined()
    expect(query.initialized).toBe(true)
    expect(query.closed).toBe(true)
    expect(query.aborted).toBe(true)
    expect(query.usageReads).toBe(1)
  })

  it('attaches product tools and re-reads once the MCP server connects', async () => {
    const query = new FakeClaudeContextQuery(undefined, { mcpStatus: 'connected' })
    const started: Options[] = []
    const usage = await measureClaudeContextUsage({
      spec: testRunSpec(),
      sessionId: 'sess-mcp',
      globalConfigDir: '/cfg/.claude',
      tools: [probeTool],
      startQuery: ({ prompt, options: next }) => {
        started.push(next)
        query.bind(prompt)
        return query
      },
    })
    expect(started[0]?.mcpServers).toBeDefined()
    expect(query.usageReads).toBe(2)
    const mcpRow = usage.categories.find((category) => category.id === 'mcpTools')
    expect(mcpRow?.tokens).toBe(7)
  })

  it('keeps the initial snapshot when the MCP server never connects', async () => {
    const query = new FakeClaudeContextQuery(undefined, { mcpStatus: 'failed' })
    const usage = await measureClaudeContextUsage({
      spec: testRunSpec(),
      sessionId: 'sess-mcp-down',
      globalConfigDir: '/cfg/.claude',
      tools: [probeTool],
      startQuery: ({ prompt }) => {
        query.bind(prompt)
        return query
      },
    })
    expect(query.usageReads).toBe(1)
    const systemPrompt = usage.categories.find((category) => category.id === 'systemPrompt')
    expect(systemPrompt?.tokens).toBe(5)
  })

  it('keeps the initial snapshot when the second usage read fails', async () => {
    const query = new FakeClaudeContextQuery(undefined, {
      mcpStatus: 'connected',
      failSecondUsage: true,
    })
    const usage = await measureClaudeContextUsage({
      spec: testRunSpec(),
      sessionId: 'sess-second-read',
      globalConfigDir: '/cfg/.claude',
      tools: [probeTool],
      startQuery: ({ prompt }) => {
        query.bind(prompt)
        return query
      },
    })
    expect(query.usageReads).toBe(2)
    const systemPrompt = usage.categories.find((category) => category.id === 'systemPrompt')
    expect(systemPrompt?.tokens).toBe(5)
    const mcpRow = usage.categories.find((category) => category.id === 'mcpTools')
    expect(mcpRow?.tokens).toBeNull()
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

interface FakeFlags {
  readonly failInit?: boolean
  readonly failSecondUsage?: boolean
  readonly mcpStatus?: 'connected' | 'failed'
}

class FakeClaudeContextQuery implements ClaudeContextQuery {
  initialized = false
  closed = false
  aborted = false
  usageReads = 0
  private prompt: AsyncIterable<SDKUserMessage> | undefined

  constructor(
    prompt?: AsyncIterable<SDKUserMessage>,
    private readonly flags: FakeFlags = {},
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

  mcpServerStatus(): ReturnType<Query['mcpServerStatus']> {
    const status = this.flags.mcpStatus ?? 'failed'
    return Promise.resolve([
      { name: 'agentWorkshop', status },
    ] as Awaited<ReturnType<Query['mcpServerStatus']>>)
  }

  getContextUsage(): ReturnType<Query['getContextUsage']> {
    this.usageReads += 1
    if (this.usageReads > 1 && this.flags.failSecondUsage === true) {
      return Promise.reject(new Error('second read failed'))
    }
    const mcpConnected = this.usageReads > 1 && this.flags.mcpStatus === 'connected'
    return Promise.resolve({
      categories: [
        { name: 'System prompt', tokens: 5, color: '' },
        { name: 'System tools', tokens: 10, color: '' },
        ...(mcpConnected ? [{ name: 'MCP tools', tokens: 7, color: '' }] : []),
        { name: 'Messages', tokens: 5, color: '' },
      ],
      totalTokens: mcpConnected ? 27 : 20,
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
