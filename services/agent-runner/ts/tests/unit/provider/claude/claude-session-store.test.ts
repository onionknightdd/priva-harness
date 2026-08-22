import { describe, expect, it, vi } from 'vitest'

import {
  ClaudeSessionStore,
  lastAssistantFromTranscriptLines,
  mapClaudeMessage,
  type ClaudeSessionSdk,
} from '../../../../src/provider/claude/session/claude-session-store.js'

describe('ClaudeSessionStore', () => {
  it('maps SDK session info and hydrates subagents on an unpaged messages GET', async () => {
    const sdk = fakeClaudeSdk()
    const store = new ClaudeSessionStore({ globalConfigDir: '/tmp/claude', sdk })
    const listed = await store.list({})
    expect(listed).toEqual([expect.objectContaining({
      ref: { provider: 'claude', id: 'sess-1' },
      customTitle: 'Named',
      firstPrompt: 'hello',
      gitBranch: 'main',
    })])

    const messages = await store.messages({ provider: 'claude', id: 'sess-1' })
    expect(messages.map((message) => message.uuid)).toEqual(['u1', 'a1', 'sub-1'])
    expect(sdk.listSubagents.mock.calls).toHaveLength(1)
    expect(sdk.getSubagentMessages.mock.calls).toHaveLength(1)

    const paged = await store.messages({ provider: 'claude', id: 'sess-1' }, { limit: 1 })
    expect(paged).toHaveLength(1)
    expect(sdk.listSubagents.mock.calls).toHaveLength(1)
  })

  it('renames, tags, and deletes through the SDK', async () => {
    const sdk = fakeClaudeSdk()
    const store = new ClaudeSessionStore({ globalConfigDir: '/tmp/claude', sdk })
    await store.rename({ provider: 'claude', id: 'sess-1' }, 'Title')
    await store.tag({ provider: 'claude', id: 'sess-1' }, 'work')
    await store.delete({ provider: 'claude', id: 'sess-1' })
    expect(sdk.renameSession.mock.calls).toEqual([['sess-1', 'Title', { dir: '/work' }]])
    expect(sdk.tagSession.mock.calls).toEqual([['sess-1', 'work', { dir: '/work' }]])
    expect(sdk.deleteSession.mock.calls).toEqual([['sess-1', { dir: '/work' }]])
  })

  it('keeps native Claude message payloads and skips synthetic transcript models', () => {
    const mapped = mapClaudeMessage({
      type: 'assistant',
      uuid: 'a1',
      session_id: 'sess-1',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1' }] },
      parent_tool_use_id: null,
    }, 'sess-1')
    expect(mapped.message).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1' }],
    })

    expect(lastAssistantFromTranscriptLines([
      JSON.stringify({
        type: 'assistant',
        isSidechain: false,
        message: { model: '<synthetic>' },
      }),
      JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        message: { model: 'claude-real' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-01-02T00:00:00.000Z',
        message: { model: 'claude-real' },
      }),
    ], 1)).toEqual({
      modelId: 'claude-real',
      observedAt: Date.parse('2026-01-02T00:00:00.000Z'),
    })
  })
})

function fakeClaudeSdk(): ClaudeSessionSdk & {
  listSubagents: ReturnType<typeof vi.fn>
  getSubagentMessages: ReturnType<typeof vi.fn>
  renameSession: ReturnType<typeof vi.fn>
  tagSession: ReturnType<typeof vi.fn>
  deleteSession: ReturnType<typeof vi.fn>
} {
  const info = {
    sessionId: 'sess-1',
    summary: 'hello',
    lastModified: new Date('2026-01-01T00:00:00.000Z'),
    fileSize: 12,
    customTitle: 'Named',
    firstPrompt: 'hello',
    gitBranch: 'main',
    cwd: '/work',
    tag: 'sdk',
  }
  return {
    listSessions: vi.fn(() => Promise.resolve([info])),
    getSessionInfo: vi.fn(() => Promise.resolve(info)),
    getSessionMessages: vi.fn(() => Promise.resolve([
      { type: 'user', uuid: 'u1', session_id: 'sess-1', message: { role: 'user' } },
      { type: 'assistant', uuid: 'a1', session_id: 'sess-1', message: { role: 'assistant' } },
    ])),
    listSubagents: vi.fn(() => Promise.resolve([{ agentId: 'agent-a' }])),
    getSubagentMessages: vi.fn(() => Promise.resolve([
      { type: 'user', uuid: 'sub-1', session_id: 'sess-1', message: { role: 'user' } },
    ])),
    deleteSession: vi.fn(() => Promise.resolve()),
    renameSession: vi.fn(() => Promise.resolve()),
    tagSession: vi.fn(() => Promise.resolve()),
  }
}
