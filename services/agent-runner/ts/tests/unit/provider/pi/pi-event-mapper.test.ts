import { describe, expect, it } from 'vitest'

import { PiEventMapper } from '../../../../src/provider/pi/pi-event-mapper.js'

describe('PiEventMapper', () => {
  it('maps text deltas, message end, and agent_end stats', () => {
    const mapper = new PiEventMapper({
      sessionId: 'pi-sess',
      model: 'deepseek-v4-flash',
      startedAt: Date.now() - 20,
    })

    const events = [
      ...mapper.push({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
      }),
      ...mapper.push({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hi' },
      }),
      ...mapper.push({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
      }),
      ...mapper.push({
        type: 'agent_end',
        messages: [{
          role: 'assistant',
          model: 'deepseek-v4-flash',
          usage: {
            input: 10,
            output: 2,
            cacheRead: 1,
            cost: { total: 0.002 },
          },
        }],
      }),
    ]

    expect(events.slice(0, 5)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant.thinking_delta', text: 'hmm' }),
      expect.objectContaining({ type: 'assistant.delta', text: 'Hi' }),
      expect.objectContaining({
        type: 'assistant.message',
        blocks: [expect.objectContaining({ type: 'text', text: 'Hi' })],
      }),
    ]))
    const completed = events.at(-1)
    expect(completed).toMatchObject({
      type: 'run.completed',
      sessionId: 'pi-sess',
      model: 'deepseek-v4-flash',
      costUsd: 0.002,
      usage: { input: 10, output: 2, cacheRead: 1 },
    })
    expect(completed?.type === 'run.completed' ? completed.durationMs : -1).toBeGreaterThanOrEqual(20)
  })

  it('does not treat user or tool-result message_end as assistant text', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })

    expect(mapper.push({
      type: 'message_end',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    })).toEqual([])
    expect(mapper.push({
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 'tc1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'pong' }],
      },
    })).toEqual([])
    expect(mapper.push({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
    })).toEqual([
      expect.objectContaining({
        type: 'assistant.message',
        blocks: [expect.objectContaining({ type: 'text', text: 'Hi' })],
      }),
    ])
  })

  it('maps agent_end with an assistant error to run.failed', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })

    expect(mapper.push({
      type: 'agent_end',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Responses API 404',
          content: [{ type: 'text', text: '' }],
        },
      ],
    })).toEqual([
      expect.objectContaining({
        type: 'run.failed',
        message: 'Responses API 404',
        sessionId: 'pi-sess',
        model: 'm',
      }),
    ])
  })

  it('defers tool.started until id is known and maps execution progress', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    const events = [
      ...mapper.push({
        type: 'message_update',
        assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0 },
      }),
      ...mapper.push({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'toolcall_delta',
          contentIndex: 0,
          delta: '{"command":',
          partial: {
            content: [{ type: 'toolCall', id: 'tc1', name: 'bash' }],
          },
        },
      }),
      ...mapper.push({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'toolcall_end',
          contentIndex: 0,
          toolCall: { id: 'tc1', name: 'bash', arguments: { command: 'echo ping' } },
        },
      }),
      ...mapper.push({
        type: 'tool_execution_start',
        toolCallId: 'tc1',
        toolName: 'bash',
        args: { command: 'echo ping' },
      }),
      ...mapper.push({
        type: 'tool_execution_update',
        toolCallId: 'tc1',
        toolName: 'bash',
        partialResult: { content: [{ type: 'text', text: 'ping\n' }] },
      }),
      ...mapper.push({
        type: 'tool_execution_end',
        toolCallId: 'tc1',
        toolName: 'bash',
        isError: false,
        result: { content: [{ type: 'text', text: 'ping\n' }] },
      }),
    ]

    expect(events[0]).toMatchObject({ type: 'assistant.block_start', kind: 'tool_use', index: 0 })
    expect(events.some((event) => event.type === 'tool.started' && events.indexOf(event) === 0)).toBe(false)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool.started', id: 'tc1', name: 'bash' }),
      expect.objectContaining({ type: 'tool.input_delta', id: 'tc1', chunk: '{"command":' }),
      expect.objectContaining({ type: 'tool.running', id: 'tc1' }),
      expect.objectContaining({ type: 'tool.progress', id: 'tc1', channel: 'stdout', chunk: 'ping\n' }),
      expect.objectContaining({ type: 'tool.completed', id: 'tc1', name: 'bash', ok: true, output: 'ping\n' }),
    ]))
  })

  it('maps edit details.patch onto tool.completed output', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    const events = mapper.push({
      type: 'tool_execution_end',
      toolCallId: 'edit1',
      toolName: 'edit',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'edited src/a.ts' }],
        details: {
          diff: 'pretty tui view',
          patch: '@@ -5,1 +5,1 @@\n-const a = 1\n+const a = 2',
        },
      },
    })
    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool.completed',
        id: 'edit1',
        name: 'edit',
        ok: true,
        output: '@@ -5,1 +5,1 @@\n-const a = 1\n+const a = 2',
      }),
    ])
  })

  it('keeps bash details.output instead of looking for a patch', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    const events = mapper.push({
      type: 'tool_execution_end',
      toolCallId: 'bash1',
      toolName: 'bash',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'ping\n' }],
        details: { output: 'ping\n' },
      },
    })
    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool.completed',
        id: 'bash1',
        name: 'bash',
        output: 'ping\n',
      }),
    ])
  })

  it('maps image deltas onto assistant.image_delta rather than text', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    const events = mapper.push({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'image_delta',
        contentIndex: 1,
        b64: 'abc',
        mime: 'image/png',
      },
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant.block_start', kind: 'image', index: 1 }),
      expect.objectContaining({ type: 'assistant.image_delta', b64: 'abc', mime: 'image/png' }),
    ]))
    expect(events.some((event) => event.type === 'assistant.delta')).toBe(false)
  })

  it('keeps message_end text on the same block id as streamed deltas', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    const events = [
      ...mapper.push({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm' },
      }),
      ...mapper.push({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'Hi!' },
      }),
      ...mapper.push({
        type: 'message_end',
        message: {
          role: 'assistant',
          id: 'asst_real',
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: 'Hi!' },
          ],
        },
      }),
    ]
    const thinking = events.find((event) => event.type === 'assistant.thinking_delta')
    const delta = events.find((event) => event.type === 'assistant.delta')
    const snapshot = events.find((event) => event.type === 'assistant.message')
    expect(thinking).toMatchObject({ type: 'assistant.thinking_delta', blockId: 'msg_1:0' })
    expect(delta).toMatchObject({ type: 'assistant.delta', blockId: 'msg_1:1' })
    expect(snapshot).toMatchObject({
      type: 'assistant.message',
      blocks: [
        expect.objectContaining({ type: 'thinking', blockId: 'msg_1:0', text: 'hmm' }),
        expect.objectContaining({ type: 'text', blockId: 'msg_1:1', text: 'Hi!' }),
      ],
    })
  })
})
