import { describe, expect, it } from 'vitest'

import {
  emptyContextUsage,
  mapClaudeContextUsage,
  mapPiContextUsage,
} from '../../../../src/core/resource/context-usage.js'

describe('context usage mapping', () => {
  it('maps Claude /context categories and ignores display-only rows', () => {
    const usage = mapClaudeContextUsage({
      totalTokens: 25867,
      maxTokens: 200000,
      rawMaxTokens: 200000,
      percentage: 13,
      categories: [
        { name: 'System prompt', tokens: 2089 },
        { name: 'System tools', tokens: 20825 },
        { name: 'MCP tools', tokens: 2869 },
        { name: 'Memory files', tokens: 134 },
        { name: 'Skills', tokens: 1821 },
        { name: 'Custom agents', tokens: 168 },
        { name: 'Messages', tokens: 84 },
        { name: 'Autocompact buffer', tokens: 33000 },
        { name: 'Free space', tokens: 141133 },
      ],
    })
    expect(usage).toEqual({
      used: 25867,
      limit: 200000,
      categories: [
        { id: 'systemPrompt', tokens: 2089 },
        { id: 'toolDefinitions', tokens: 20825 },
        { id: 'skills', tokens: 1821 },
        { id: 'mcpTools', tokens: 2869 },
        { id: 'subagentDefinitions', tokens: 168 },
        { id: 'memory', tokens: 134 },
        { id: 'conversation', tokens: 84 },
      ],
    })
  })

  it('maps deferred and aliased Claude tool rows onto the same categories', () => {
    const usage = mapClaudeContextUsage({
      totalTokens: 5000,
      maxTokens: 200000,
      categories: [
        { name: 'System prompt', tokens: 1000 },
        { name: 'System tools (deferred)', tokens: 18000, isDeferred: true },
        { name: 'MCP tools (deferred)', tokens: 4000, isDeferred: true, kind: 'deferred' },
        { name: 'Messages', tokens: 500 },
        { name: 'Free space', tokens: 176500, kind: 'free' },
      ],
    })
    expect(usage).toEqual({
      used: 5000,
      limit: 200000,
      categories: [
        { id: 'systemPrompt', tokens: 1000 },
        { id: 'toolDefinitions', tokens: 18000 },
        { id: 'skills', tokens: null },
        { id: 'mcpTools', tokens: 4000 },
        { id: 'subagentDefinitions', tokens: null },
        { id: 'memory', tokens: null },
        { id: 'conversation', tokens: 500 },
      ],
    })
  })

  it('sums loaded and deferred tool rows and falls back to detail arrays', () => {
    expect(mapClaudeContextUsage({
      total_tokens: 22000,
      raw_max_tokens: 200000,
      categories: [
        { name: '[ANT-ONLY] System tools', tokens: 2000 },
        { name: 'System tools (deferred)', tokens: 18000 },
      ],
    }).categories).toEqual([
      { id: 'systemPrompt', tokens: null },
      { id: 'toolDefinitions', tokens: 20000 },
      { id: 'skills', tokens: null },
      { id: 'mcpTools', tokens: null },
      { id: 'subagentDefinitions', tokens: null },
      { id: 'memory', tokens: null },
      { id: 'conversation', tokens: null },
    ])
    expect(mapClaudeContextUsage({
      totalTokens: 12,
      maxTokens: 200000,
      categories: [{ name: 'Messages', tokens: 12 }],
      systemTools: [{ name: 'Read', tokens: 8 }, { name: 'Bash', tokens: 4 }],
      mcp_tools: [{ name: 'mcp__agentWorkshop__visualize', tokens: 30 }],
    })).toEqual({
      used: 12,
      limit: 200000,
      categories: [
        { id: 'systemPrompt', tokens: null },
        { id: 'toolDefinitions', tokens: 12 },
        { id: 'skills', tokens: null },
        { id: 'mcpTools', tokens: 30 },
        { id: 'subagentDefinitions', tokens: null },
        { id: 'memory', tokens: null },
        { id: 'conversation', tokens: 12 },
      ],
    })
  })

  it('returns an empty snapshot for invalid Claude payloads', () => {
    expect(mapClaudeContextUsage(undefined)).toEqual(emptyContextUsage())
    expect(mapClaudeContextUsage({ totalTokens: 'nope' })).toEqual({
      ...emptyContextUsage(),
      used: null,
      limit: null,
    })
  })

  it('maps Pi totals without inventing categories', () => {
    expect(mapPiContextUsage(undefined)).toEqual(emptyContextUsage())
    expect(mapPiContextUsage({ tokens: 1844, contextWindow: 1_000_000 })).toEqual({
      used: 1844,
      limit: 1_000_000,
      categories: emptyContextUsage().categories,
    })
    expect(mapPiContextUsage({ tokens: null, contextWindow: 200000 })).toEqual({
      used: null,
      limit: 200000,
      categories: emptyContextUsage().categories,
    })
  })
})
