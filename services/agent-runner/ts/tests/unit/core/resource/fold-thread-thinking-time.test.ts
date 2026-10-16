import { describe, expect, it } from 'vitest'

import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import type { ThreadReplayItem } from '../../../../src/core/resource/thread.js'

describe('foldThread thinking duration', () => {
  it('records elapsed thinking time from replay frame timestamps', () => {
    const thread = foldThread([
      user('u1', 'ship it'),
      frame(
        {
          type: 'assistant.thinking_delta',
          messageId: 'a1',
          blockId: 'think',
          index: 0,
          text: 'plan',
        },
        '2024-01-01T00:00:01.000Z',
      ),
      frame(
        {
          type: 'assistant.thinking_delta',
          messageId: 'a1',
          blockId: 'think',
          index: 0,
          text: ' more',
        },
        '2024-01-01T00:00:03.500Z',
      ),
      frame(
        {
          type: 'tool.started',
          messageId: 'a1',
          blockId: 'bash-1',
          index: 1,
          id: 'bash-1',
          name: 'bash',
        },
        '2024-01-01T00:00:04.000Z',
      ),
    ])

    const thinking = thread[1]?.blocks?.find((block) => block.type === 'thinking')
    expect(thinking).toMatchObject({
      type: 'thinking',
      text: 'plan more',
      startedAt: Date.parse('2024-01-01T00:00:01.000Z'),
      durationMs: 3_000,
    })
  })

  it('does not invent thinking duration when snapshot frames share one timestamp', () => {
    const thread = foldThread([
      user('u1', 'ship it'),
      frame(
        {
          type: 'assistant.message',
          messageId: 'a1',
          blocks: [
            { type: 'thinking', blockId: 'think', index: 0, text: 'plan' },
            { type: 'tool_use', blockId: 'bash-1', index: 1, id: 'bash-1', name: 'bash' },
          ],
        },
        '2024-01-01T00:00:01.000Z',
      ),
      frame(
        {
          type: 'tool.started',
          messageId: 'a1',
          blockId: 'bash-1',
          index: 1,
          id: 'bash-1',
          name: 'bash',
        },
        '2024-01-01T00:00:01.000Z',
      ),
    ])

    const thinking = thread[1]?.blocks?.find((block) => block.type === 'thinking')
    expect(thinking).toMatchObject({
      type: 'thinking',
      text: 'plan',
      startedAt: Date.parse('2024-01-01T00:00:01.000Z'),
      durationMs: 0,
    })
  })

  it('keeps the run duration from the result, and otherwise the span of replay timestamps', () => {
    const reported = foldThread([
      frame({ type: 'assistant.delta', messageId: 'a1', blockId: 'text', index: 0, text: 'hi' }, '2024-01-01T00:00:01.000Z'),
      frame({ type: 'run.completed', model: 'test', durationMs: 12_500 }, '2024-01-01T00:00:20.000Z'),
    ])
    expect(reported[0]?.durationMs).toBe(12_500)

    const spanned = foldThread([
      frame({ type: 'assistant.delta', messageId: 'a1', blockId: 'text', index: 0, text: 'hi' }, '2024-01-01T00:00:01.000Z'),
      frame({ type: 'assistant.delta', messageId: 'a1', blockId: 'text', index: 0, text: ' there' }, '2024-01-01T00:00:06.000Z'),
    ])
    expect(spanned[0]?.durationMs).toBe(5_000)
  })
})

function user(id: string, content: string): ThreadReplayItem {
  return {
    kind: 'user',
    id,
    content,
    createdAt: '2024-01-01T00:00:00.000Z',
  }
}

function frame(event: AgentEvent, createdAt: string): ThreadReplayItem {
  return { kind: 'frame', event, createdAt }
}
