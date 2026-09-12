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
        code: 'api_error',
        sessionId: 'pi-sess',
        model: 'm',
      }),
    ])
  })

  it('classifies assistant errors from their message text', () => {
    const codeFor = (errorMessage: string): unknown => {
      const event = new PiEventMapper({ sessionId: 's', model: 'm' }).push({
        type: 'agent_end',
        messages: [{ role: 'assistant', stopReason: 'error', errorMessage, content: [] }],
      })[0]
      return event?.type === 'run.failed' ? event.code : undefined
    }
    expect(codeFor('401 Unauthorized')).toBe('auth_error')
    expect(codeFor('Invalid API key provided')).toBe('auth_error')
    expect(codeFor('529 overloaded_error')).toBe('api_error')
    expect(codeFor('rate limit exceeded')).toBe('api_error')
    expect(codeFor('fetch failed')).toBe('api_error')
    expect(codeFor('model returned malformed tool call')).toBe('provider_error')
  })

  it('sums usage across every assistant message of the run and buckets it by model', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'main' })
    const usage = (input: number, output: number, cacheRead: number, cacheWrite: number, total: number) =>
      ({ input, output, cacheRead, cacheWrite, cost: { total } })
    const event = mapper.push({
      type: 'agent_end',
      messages: [
        { role: 'user', content: [] },
        { role: 'assistant', model: 'main', usage: usage(0, 100, 0, 1000, 0.02), content: [] },
        { role: 'toolResult', content: [] },
        { role: 'assistant', model: 'main', usage: usage(0, 50, 1000, 200, 0.01), content: [] },
        { role: 'assistant', model: 'small', usage: usage(30, 10, 0, 0, 0.001), content: [] },
        { role: 'assistant', content: [] },
      ],
    })[0]

    expect(event).toMatchObject({
      type: 'run.completed',
      model: 'main',
      numTurns: 4,
      usage: { input: 30, output: 160, cacheRead: 1000, cacheWrite: 1200 },
      byModel: {
        main: { input: 0, output: 150, cacheRead: 1000, cacheWrite: 1200, costUsd: expect.closeTo(0.03, 6) as number },
        small: { input: 30, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 },
      },
      costUsd: expect.closeTo(0.031, 6) as number,
    })
  })

  it('reports numTurns without usage when assistant messages carry none', () => {
    const event = new PiEventMapper({ sessionId: 's', model: 'm' }).push({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [] }],
    })[0]
    expect(event).toMatchObject({ type: 'run.completed', numTurns: 1 })
    expect(event !== undefined && 'usage' in event ? event.usage : undefined).toBeUndefined()
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

  it('maps Read text content onto a $read envelope', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    const events = mapper.push({
      type: 'tool_execution_end',
      toolCallId: 'read1',
      toolName: 'read',
      isError: false,
      result: { content: [{ type: 'text', text: 'const a = 1' }] },
    })
    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool.completed',
        id: 'read1',
        name: 'read',
        output: JSON.stringify({ $read: 'text', content: 'const a = 1', startLine: 1 }),
      }),
    ])
  })

  it('maps Read image content onto a $read envelope', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    const events = mapper.push({
      type: 'tool_execution_end',
      toolCallId: 'readimg',
      toolName: 'read',
      isError: false,
      result: { content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }] },
    })
    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool.completed',
        id: 'readimg',
        name: 'read',
        output: JSON.stringify({ $read: 'image', mime: 'image/png', b64: 'abc' }),
      }),
    ])
  })

  it('does not encode Read progress chunks as $read JSON', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    const events = mapper.push({
      type: 'tool_execution_update',
      toolCallId: 'read1',
      toolName: 'read',
      partialResult: { content: [{ type: 'text', text: 'const a = 1' }] },
    })
    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool.progress',
        id: 'read1',
        chunk: 'const a = 1',
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

  it('maps compaction start and a successful compact result', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    expect(mapper.push({ type: 'compaction_start', reason: 'manual' })).toEqual([
      { type: 'session.compacting' },
    ])
    expect(mapper.push({
      type: 'compaction_end',
      reason: 'manual',
      result: { summary: 'Kept COMPACT-PROBE tokens.', firstKeptEntryId: 'abc' },
      aborted: false,
    })).toEqual([
      { type: 'session.compacted', summary: 'Kept COMPACT-PROBE tokens.' },
    ])
  })

  it('maps a failed compact to run.failed', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    expect(mapper.push({
      type: 'compaction_end',
      reason: 'manual',
      aborted: false,
      errorMessage: 'Nothing to compact (session too small)',
    })).toEqual([
      expect.objectContaining({
        type: 'run.failed',
        message: 'Nothing to compact (session too small)',
        sessionId: 'pi-sess',
        model: 'm',
      }),
    ])
  })
})
