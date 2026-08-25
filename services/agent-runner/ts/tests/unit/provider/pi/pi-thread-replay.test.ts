import { describe, expect, it } from 'vitest'

import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import { replayPiSessionMessages } from '../../../../src/provider/pi/pi-thread-replay.js'
import type { SessionMessage } from '../../../../src/core/resource/session.js'

describe('replayPiSessionMessages', () => {
  it('keeps tool results on the assistant turn and skips compaction', () => {
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
    expect(thread.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(thread[1]?.content).toBe('running')
    const tool = thread[1]?.blocks?.find((block) => block.type === 'tool_use')
    expect(tool).toMatchObject({
      id: 'call-1',
      name: 'bash',
      tool: { status: 'completed', ok: true, output: 'ok' },
    })
  })
})
