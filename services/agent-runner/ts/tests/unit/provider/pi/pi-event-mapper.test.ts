import { describe, expect, it } from 'vitest'

import { PiEventMapper, type PiSessionEvent } from '../../../../src/provider/pi/pi-event-mapper.js'

describe('PiEventMapper', () => {
  it('preserves structured-only native tool progress', () => {
    const mapper = new PiEventMapper({ sessionId: 's', model: 'm' })
    mapper.push({ type: 'tool_execution_start', toolCallId: 'child', toolName: 'mcp__a__read', parentToolCallId: 'outer' })
    expect(mapper.push({ type: 'tool_execution_update', toolCallId: 'child', partialResult: { content: [], structuredContent: { progress: 0.5 } } })).toMatchObject([
      { type: 'tool.progress', parentToolCallId: 'outer', structuredContent: { progress: 0.5 } },
    ])
  })

  it('waits for agent_settled across continuations and preserves usage after abort without duplicates', () => {
    const mapper = new PiEventMapper({ sessionId: 's', model: 'm' })
    const first = { role: 'assistant', timestamp: 1, model: 'm', usage: { input: 10, output: 2, cost: { total: 0.2 } }, content: [] }
    mapper.push({ type: 'agent_start' })
    mapper.push({ type: 'message_end', message: first })
    expect(mapper.push({ type: 'agent_end', messages: [first] })).toEqual([])
    mapper.push({ type: 'agent_start' })
    const second = { role: 'assistant', timestamp: 2, model: 'm', usage: { input: 3, output: 1, cost: { total: 0.1 } }, content: [], stopReason: 'aborted' }
    mapper.push({ type: 'agent_end', messages: [second] })
    expect(mapper.push({ type: 'agent_settled', aborted: true })[0]).toMatchObject({
      type: 'run.aborted', numTurns: 2, usage: { input: 13, output: 3 }, costUsd: expect.closeTo(0.3) as number,
    })
    mapper.push({ type: 'agent_start' })
    mapper.push({ type: 'agent_end', messages: [first] })
    expect(mapper.push({ type: 'agent_settled' })[0]).toMatchObject({ numTurns: 1, usage: { input: 10, output: 2 } })
  })

  it('keeps nested tool identity and structured results separate from subagents', () => {
    const mapper = new PiEventMapper({ sessionId: 's', model: 'm' })
    mapper.push({ type: 'tool_execution_start', toolCallId: 'outer', toolName: 'codemode', args: { code: '...' } })
    const started = mapper.push({ type: 'tool_execution_start', toolCallId: 'outer/1', parentToolCallId: 'outer', toolName: 'mcp__docs__find', args: { query: 'pi' } })
    expect(started[0]).toMatchObject({ type: 'tool.started', parentToolCallId: 'outer', name: 'mcp__docs__find' })
    expect(started[0]).not.toHaveProperty('parentToolUseId')
    const complete = mapper.push({ type: 'tool_execution_end', toolCallId: 'outer/1', toolName: 'mcp__docs__find', isError: true,
      result: { content: [{ type: 'text', text: 'failed' }], structuredContent: ['details'] } })
    expect(complete[0]).toMatchObject({ type: 'tool.completed', parentToolCallId: 'outer', ok: false, structuredContent: ['details'] })
  })

  it('counts outer tool usage once and attributes model invocations without inventing unknown costs', () => {
    const mapper = new PiEventMapper({ sessionId: 's', model: 'chat' })
    const result = settle(mapper, { type: 'agent_end', messages: [{ role: 'toolResult', toolCallId: 'outer',
      usage: { input: 12, output: 8, cacheRead: 0, cacheWrite: 0, cost: { total: 0.2 } },
      details: { harnessModelCalls: [
        { id: 'a', parentToolCallId: 'outer', operation: 'classify', provider: 'native', model: 'judge', status: 'completed', usage: { input: 4, output: 1 }, costUsd: 0.2 },
        { id: 'b', parentToolCallId: 'outer', operation: 'generateImages', provider: 'native', model: 'painter', status: 'completed', usage: { input: 8, output: 7 }, pricingKnown: false },
      ] },
    }] })[0]
    expect(result).toMatchObject({ usage: { input: 12, output: 8 }, costUsd: 0.2,
      byModel: { 'native/judge': { input: 4, output: 1, costUsd: 0.2 }, 'native/painter': { input: 8, output: 7 } } })
    if (result?.type !== 'run.completed') throw new Error('Missing completion')
    expect(result.byModel?.['native/painter']).not.toHaveProperty('costUsd')
    expect(result.byModel).not.toHaveProperty('Tools/summaries')
  })
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
      ...settle(mapper, {
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
    })).toEqual([expect.objectContaining({ type: 'tool.completed', id: 'tc1', output: 'pong' })])
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

    expect(settle(mapper, {
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
      const event = settle(new PiEventMapper({ sessionId: 's', model: 'm' }), {
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
    const event = settle(mapper, {
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
    const event = settle(new PiEventMapper({ sessionId: 's', model: 'm' }), {
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
      { type: 'session.compacting', reason: 'manual' },
    ])
    expect(mapper.push({
      type: 'compaction_end',
      reason: 'manual',
      result: { summary: 'Kept COMPACT-PROBE tokens.', firstKeptEntryId: 'abc' },
      aborted: false,
    })).toEqual([
      { type: 'session.compacted', reason: 'manual', summary: 'Kept COMPACT-PROBE tokens.' },
    ])
  })

  it('reports a failed compact without ending the native run', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    expect(mapper.push({
      type: 'compaction_end',
      reason: 'manual',
      aborted: false,
      errorMessage: 'Nothing to compact (session too small)',
    })).toEqual([
      {
        type: 'session.compaction_failed',
        reason: 'manual',
        message: 'Nothing to compact (session too small)',
      },
    ])
  })

  it.each(['manual', 'threshold', 'overflow'])('preserves native cancellation for %s compaction', (reason) => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    expect(mapper.push({ type: 'compaction_end', reason, aborted: true })).toEqual([
      { type: 'session.compaction_cancelled', reason: reason === 'manual' ? 'manual' : 'auto' },
    ])
  })

  it('keeps overflow recovery and its continuation in the same run until agent_settled', () => {
    const mapper = new PiEventMapper({ sessionId: 'pi-sess', model: 'm' })
    mapper.push({ type: 'agent_start' })
    expect(mapper.push({ type: 'compaction_start', reason: 'overflow' })).toEqual([
      { type: 'session.compacting', reason: 'auto' },
    ])
    expect(mapper.push({ type: 'compaction_end', reason: 'overflow', result: { summary: 'Recovered context' }, aborted: false, willRetry: true })).toEqual([
      { type: 'session.compacted', reason: 'auto', summary: 'Recovered context' },
    ])
    mapper.push({ type: 'agent_start' })
    const message = { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'Recovered answer' }], stopReason: 'stop', usage: { input: 4, output: 2 } }
    expect(mapper.push({ type: 'agent_end', messages: [message] })).toEqual([])
    expect(mapper.push({ type: 'agent_settled', aborted: false })).toEqual([
      expect.objectContaining({ type: 'run.completed', usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0 } }),
    ])
  })
})

function settle(mapper: PiEventMapper, event: PiSessionEvent) {
  expect(mapper.push(event)).toEqual([])
  return mapper.push({ type: 'agent_settled', aborted: false })
}
