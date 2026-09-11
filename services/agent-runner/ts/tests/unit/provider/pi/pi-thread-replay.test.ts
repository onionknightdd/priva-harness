import { describe, expect, it } from 'vitest'

import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import { replayPiSessionMessages } from '../../../../src/provider/pi/pi-thread-replay.js'
import type { SessionMessage } from '../../../../src/core/resource/session.js'

describe('replayPiSessionMessages', () => {
  it('keeps native task notices out of user messages and attaches the model follow-up to the launch', () => {
    const entry = (type: SessionMessage['type'], uuid: string, message: unknown): SessionMessage => ({ type, uuid, message,
      sessionId: 's', parentToolUseId: null, metadata: null, timestamp: 1 })
    const replay = replayPiSessionMessages([
      entry('assistant', 'launch', { role: 'assistant', content: [{ type: 'toolCall', id: 'tool', name: 'Agent', arguments: {} }] }),
      entry('tool_result', 'result', { role: 'toolResult', toolCallId: 'tool', toolName: 'Agent', details: { agentId: 'job', status: 'background' }, content: 'started' }),
      entry('assistant', 'reply', { role: 'assistant', content: 'Background started' }),
      entry('custom', 'notice', { role: 'custom', customType: 'subagent-notification', details: { id: 'job', status: 'completed' }, content: '<task-notification>native</task-notification>' }),
      entry('assistant', 'followup', { role: 'assistant', content: 'Background finished' }),
      entry('user', 'human', { role: 'user', content: '<task-notification>human</task-notification>' }),
    ])
    const thread = foldThread(replay)
    expect(thread.map((message) => message.role)).toEqual(['assistant', 'user'])
    expect(thread[0]?.blocks?.find((block) => block.type === 'tool_use')).toMatchObject({ tool: { backgroundTask: { taskId: 'job', status: 'completed' } } })
    expect(thread[0]?.content).toBe('Background finished')
    expect(thread[1]?.content).toContain('human')
  })

  it('keeps tool results on the assistant turn and surfaces compaction', () => {
    const messages: SessionMessage[] = [
      {
        type: 'user',
        uuid: 'e1',
        sessionId: 'bb-1',
        message: { role: 'user', content: 'tool me' },
        parentToolUseId: null,
        metadata: null,
        timestamp: null,
      },
      {
        type: 'assistant',
        uuid: 'e2',
        sessionId: 'bb-1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'running' },
            { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'ls' } },
          ],
        },
        parentToolUseId: null,
        metadata: null,
        timestamp: null,
      },
      {
        type: 'tool_result',
        uuid: 'e3',
        sessionId: 'bb-1',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'ok' }],
        },
        parentToolUseId: 'call-1',
        metadata: null,
        timestamp: null,
      },
      {
        type: 'compaction',
        uuid: 'e4',
        sessionId: 'bb-1',
        message: { role: 'compactionSummary', summary: 'compacted' },
        parentToolUseId: null,
        metadata: null,
        timestamp: null,
      },
    ]

    const thread = foldThread(replayPiSessionMessages(messages))
    expect(thread.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(thread[2]).toMatchObject({
      role: 'user',
      content: '/compact',
      compact: { phase: 'compacted', summary: 'compacted' },
    })
    expect(thread[1]?.content).toBe('')
    expect(
      thread[1]?.blocks?.find((block) => block.type === 'text' && block.text === 'running'),
    ).toBeDefined()
    const tool = thread[1]?.blocks?.find((block) => block.type === 'tool_use')
    expect(tool).toMatchObject({
      id: 'call-1',
      name: 'bash',
      tool: { status: 'completed', ok: true, output: 'ok' },
    })
  })

  it('replays edit details.patch as the tool output', () => {
    const messages: SessionMessage[] = [
      {
        type: 'assistant',
        uuid: 'e1',
        sessionId: 'bb-1',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'edit-1', name: 'edit', arguments: { path: 'a.ts' } }],
        },
        parentToolUseId: null,
        metadata: null,
        timestamp: null,
      },
      {
        type: 'tool_result',
        uuid: 'e2',
        sessionId: 'bb-1',
        message: {
          role: 'toolResult',
          toolCallId: 'edit-1',
          toolName: 'edit',
          content: [{ type: 'text', text: 'edited' }],
          details: { patch: '@@ -9,1 +9,1 @@\n-a\n+b' },
        },
        parentToolUseId: 'edit-1',
        metadata: null,
        timestamp: null,
      },
    ]
    const thread = foldThread(replayPiSessionMessages(messages))
    const tool = thread[0]?.blocks?.find((block) => block.type === 'tool_use')
    expect(tool).toMatchObject({
      id: 'edit-1',
      name: 'edit',
      tool: { status: 'completed', ok: true, output: '@@ -9,1 +9,1 @@\n-a\n+b' },
    })
  })

  it('replays Read image content as a $read envelope', () => {
    const messages: SessionMessage[] = [
      {
        type: 'assistant',
        uuid: 'r1',
        sessionId: 'bb-1',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'shot.png' } }],
        },
        parentToolUseId: null,
        metadata: null,
        timestamp: null,
      },
      {
        type: 'tool_result',
        uuid: 'r2',
        sessionId: 'bb-1',
        message: {
          role: 'toolResult',
          toolCallId: 'read-1',
          toolName: 'read',
          content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
        },
        parentToolUseId: 'read-1',
        metadata: null,
        timestamp: null,
      },
    ]
    const thread = foldThread(replayPiSessionMessages(messages))
    const tool = thread[0]?.blocks?.find((block) => block.type === 'tool_use')
    expect(tool).toMatchObject({
      id: 'read-1',
      name: 'read',
      tool: {
        status: 'completed',
        ok: true,
        output: JSON.stringify({ $read: 'image', mime: 'image/png', b64: 'abc' }),
      },
    })
  })
})
