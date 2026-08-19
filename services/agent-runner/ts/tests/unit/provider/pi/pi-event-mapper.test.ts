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

    expect(events.slice(0, 3)).toEqual([
      { type: 'assistant', event: 'thinking_delta', text: 'hmm' },
      { type: 'assistant', event: 'text_delta', text: 'Hi' },
      { type: 'assistant', event: 'message', text: 'Hi' },
    ])
    const completed = events[3]
    expect(completed).toMatchObject({
      type: 'run',
      event: 'completed',
      sessionId: 'pi-sess',
      harnessProvider: 'pi',
      model: 'deepseek-v4-flash',
      costUsd: 0.002,
      usage: { input: 10, output: 2, cacheRead: 1 },
    })
    expect(completed?.type === 'run' && completed.event === 'completed'
      ? completed.durationMs
      : -1).toBeGreaterThanOrEqual(20)
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

    expect(events).toEqual([
      { type: 'tool', event: 'started', id: 'tc1', name: 'bash' },
      { type: 'tool', event: 'input_delta', id: 'tc1', chunk: '{"command":' },
      { type: 'tool', event: 'running', id: 'tc1' },
      { type: 'tool', event: 'progress', id: 'tc1', channel: 'stdout', chunk: 'ping\n' },
      { type: 'tool', event: 'completed', id: 'tc1', name: 'bash', ok: true, output: 'ping\n' },
    ])
  })
})
