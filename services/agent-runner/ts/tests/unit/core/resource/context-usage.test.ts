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
