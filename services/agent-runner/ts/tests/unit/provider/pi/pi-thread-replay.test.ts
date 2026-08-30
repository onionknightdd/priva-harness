import { describe, expect, it } from 'vitest'

import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import { replayPiSessionMessages } from '../../../../src/provider/pi/pi-thread-replay.js'
import type { SessionMessage } from '../../../../src/core/resource/session.js'

describe('replayPiSessionMessages', () => {
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
