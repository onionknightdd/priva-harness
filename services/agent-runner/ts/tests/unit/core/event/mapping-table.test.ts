import { describe, expect, it } from 'vitest'

import { ClaudeEventMapper } from '../../../../src/provider/claude/claude-event-mapper.js'
import { PiEventMapper } from '../../../../src/provider/pi/pi-event-mapper.js'

describe('SDK to product mapping table', () => {
  it('maps Claude text, thinking, image, and tool stream events', () => {
    const mapper = new ClaudeEventMapper()
    const types = [
      ...mapper.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } },
      }),
      ...mapper.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'hmm' } },
      }),
      ...mapper.push({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'image_delta', data: 'abc', media_type: 'image/png' },
        },
      }),
      ...mapper.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 3,
          content_block: { type: 'tool_use', id: 'call_1', name: 'Bash' },
        },
      }),
    ].map((event) => event.type)

    expect(types).toContain('assistant.delta')
    expect(types).toContain('assistant.thinking_delta')
    expect(types).toContain('assistant.image_delta')
    expect(types).toContain('assistant.block_start')
    expect(types).toContain('tool.started')
  })

  it('maps Pi deltas, deferred tool id, and agent_end', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-1', model: 'm' })
    const beforeId = mapper.push({
      type: 'message_update',
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0 },
    })
    expect(beforeId.some((event) => event.type === 'tool.started')).toBe(false)
    expect(beforeId.some((event) => event.type === 'assistant.block_start')).toBe(true)

    const withId = mapper.push({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_delta',
        contentIndex: 0,
        delta: '{"x":',
        partial: { content: [{ type: 'toolCall', id: 'tc1', name: 'bash' }] },
      },
    })
    expect(withId.some((event) => event.type === 'tool.started')).toBe(true)
    expect(withId.some((event) => event.type === 'tool.input_delta')).toBe(true)

    const ended = mapper.push({
      type: 'agent_end',
      messages: [{ role: 'assistant', model: 'm', usage: { input: 1, output: 1 } }],
    })
    expect(ended[0]?.type).toBe('run.completed')
  })
})
