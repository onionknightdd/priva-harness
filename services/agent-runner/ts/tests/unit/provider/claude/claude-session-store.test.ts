import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { foldThread } from '../../../../src/core/resource/fold-thread.js'
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

  it('renames, tags, deletes, and forks through the SDK', async () => {
    const sdk = fakeClaudeSdk()
    const store = new ClaudeSessionStore({ globalConfigDir: '/tmp/claude', sdk })
    await store.rename({ provider: 'claude', id: 'sess-1' }, 'Title')
    await store.tag({ provider: 'claude', id: 'sess-1' }, 'work')
    const forked = await store.fork(
      { provider: 'claude', id: 'sess-1' },
      { title: 'Named (1)', upToMessageId: 'a1' },
    )
    await store.delete({ provider: 'claude', id: 'sess-1' })
    expect(sdk.renameSession.mock.calls).toEqual([['sess-1', 'Title', { dir: '/work' }]])
    expect(sdk.tagSession.mock.calls).toEqual([['sess-1', 'work', { dir: '/work' }]])
    expect(sdk.forkSession.mock.calls).toEqual([[
      'sess-1',
      { dir: '/work', title: 'Named (1)', upToMessageId: 'a1' },
    ]])
    expect(forked).toEqual(expect.objectContaining({
      ref: { provider: 'claude', id: 'fork-1' },
      customTitle: 'Named (1)',
    }))
    expect(sdk.deleteSession.mock.calls).toEqual([['sess-1', { dir: '/work' }]])
  })

  it('copies JSONL-root tool_use_result onto the inner message for replay', () => {
    const mapped = mapClaudeMessage({
      type: 'user',
      uuid: 't1',
      session_id: 'sess-1',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'edit_1', content: '     12\tkeep' }],
      },
      tool_use_result: {
        structuredPatch: [{ oldStart: 12, oldLines: 1, newStart: 12, newLines: 1, lines: [' keep'] }],
      },
    }, 'sess-1')
    expect(mapped.message).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'edit_1', content: '     12\tkeep' }],
      tool_use_result: {
        structuredPatch: [{ oldStart: 12, oldLines: 1, newStart: 12, newLines: 1, lines: [' keep'] }],
      },
    })
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
    expect(mapped.parentToolUseId).toBeNull()
    expect(mapped.timestamp).toBeNull()

    expect(mapClaudeMessage({
      type: 'assistant',
      uuid: 'a2',
      timestamp: '2026-01-02T00:00:00.000Z',
      message: { role: 'assistant', content: 'ok' },
    }, 'sess-1').timestamp).toBe(Date.parse('2026-01-02T00:00:00.000Z'))

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

  it('hydrates SDK-stripped Edit toolUseResult from the jsonl transcript', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'priva-claude-transcript-'))
    try {
      const project = join(configDir, 'projects', '-work')
      await mkdir(project, { recursive: true })
      await writeFile(join(project, 'sess-1.jsonl'), [
        JSON.stringify({
          type: 'assistant',
          uuid: 'a1',
          message: {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'edit-1',
              name: 'Edit',
              input: { file_path: '/Users/derekdeng/random_note.md', old_string: 'a', new_string: '测试\n' },
            }],
          },
        }),
        JSON.stringify({
          type: 'user',
          uuid: 't1',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'edit-1',
              content: 'The file has been updated successfully. (file state is current in your context — no need to Read it back)',
            }],
          },
          toolUseResult: {
            structuredPatch: [{
              oldStart: 4,
              oldLines: 8,
              newStart: 4,
              newLines: 7,
              lines: [
                ' ',
                ' ## 今日要点',
                ' ',
                '-- 完成文件写入测试',
                '-- 保持简单直接',
                '+测试',
                ' ',
                ' ## 随手记',
                ' xxxx',
              ],
            }],
          },
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'bash-t',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: 'ok\n' }],
          },
          toolUseResult: { stdout: 'ok\n', stderr: '', interrupted: false },
        }),
      ].join('\n'))

      const sdk = fakeClaudeSdk()
      sdk.listSubagents = vi.fn(() => Promise.resolve([]))
      sdk.getSessionMessages = vi.fn(() => Promise.resolve([
        {
          type: 'assistant',
          uuid: 'a1',
          session_id: 'sess-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'edit-1',
                name: 'Edit',
                input: { file_path: '/Users/derekdeng/random_note.md', old_string: 'a', new_string: '测试\n' },
              },
              {
                type: 'tool_use',
                id: 'bash-1',
                name: 'Bash',
                input: { command: 'pwd' },
              },
            ],
          },
        },
        {
          type: 'user',
          uuid: 't1',
          session_id: 'sess-1',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'edit-1',
              content: 'The file has been updated successfully. (file state is current in your context — no need to Read it back)',
            }],
          },
        },
        {
          type: 'user',
          uuid: 'bash-t',
          session_id: 'sess-1',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: 'ok\n' }],
          },
        },
      ]))

      const store = new ClaudeSessionStore({ globalConfigDir: configDir, sdk })
      const hydrated = await store.messages({ provider: 'claude', id: 'sess-1' })
      expect(hydrated.find((message) => message.uuid === 't1')?.message).toMatchObject({
        tool_use_result: {
          structuredPatch: [expect.objectContaining({ oldStart: 4, newStart: 4 })],
        },
      })

      const thread = foldThread(await store.replay({ provider: 'claude', id: 'sess-1' }))
      const edit = thread[0]?.blocks?.find((block) => block.type === 'tool_use' && block.id === 'edit-1')
      const bash = thread[0]?.blocks?.find((block) => block.type === 'tool_use' && block.id === 'bash-1')
      expect(edit?.type).toBe('tool_use')
      if (edit?.type !== 'tool_use') {
        throw new Error('expected Edit tool_use block')
      }
      expect(edit.tool).toMatchObject({
        status: 'completed',
        ok: true,
      })
      expect(edit.tool?.output).toMatch(/^@@ -4,8 \+4,7 @@/)
      expect(edit.tool?.output).toContain('+测试')
      expect(bash).toMatchObject({
        name: 'bash',
        tool: { status: 'completed', ok: true, output: 'ok\n' },
      })
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })
})

function fakeClaudeSdk(): ClaudeSessionSdk & {
  listSubagents: ReturnType<typeof vi.fn>
  getSubagentMessages: ReturnType<typeof vi.fn>
  renameSession: ReturnType<typeof vi.fn>
  tagSession: ReturnType<typeof vi.fn>
  deleteSession: ReturnType<typeof vi.fn>
  forkSession: ReturnType<typeof vi.fn>
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
  const forked = {
    ...info,
    sessionId: 'fork-1',
    customTitle: 'Named (1)',
    summary: 'Named (1)',
  }
  return {
    listSessions: vi.fn(() => Promise.resolve([info])),
    getSessionInfo: vi.fn((sessionId: string) => Promise.resolve(
      sessionId === 'fork-1' ? forked : info,
    )),
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
    forkSession: vi.fn(() => Promise.resolve({ sessionId: 'fork-1' })),
  }
}
