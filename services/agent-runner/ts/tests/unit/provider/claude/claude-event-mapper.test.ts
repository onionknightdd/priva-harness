import { describe, expect, it } from 'vitest'

import { ClaudeEventMapper } from '../../../../src/provider/claude/claude-event-mapper.js'

describe('ClaudeEventMapper', () => {
  it('maps text deltas, a complete assistant message, and a successful result', () => {
    const mapper = new ClaudeEventMapper()
    const events = [
      ...mapper.push({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
        message: { model: 'deepseek-v4-flash[1m]' },
      }),
      ...mapper.push({
        type: 'stream_event',
        session_id: 'sess-1',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        },
      }),
      ...mapper.push({
        type: 'assistant',
        session_id: 'sess-1',
        message: {
          model: 'deepseek-v4-flash[1m]',
          content: [{ type: 'text', text: 'Hello' }],
        },
      }),
      ...mapper.push({
        type: 'result',
        subtype: 'success',
        session_id: 'sess-1',
        duration_ms: 42,
        total_cost_usd: 0.01,
        usage: { input_tokens: 12, output_tokens: 4, cache_read_input_tokens: 3 },
      }),
    ]

    expect(events).toEqual([
      { type: 'assistant', event: 'text_delta', text: 'Hello' },
      { type: 'assistant', event: 'message', text: 'Hello' },
      {
        type: 'run',
        event: 'completed',
        sessionId: 'sess-1',
        harnessProvider: 'claude',
        model: 'deepseek-v4-flash[1m]',
        durationMs: 42,
        costUsd: 0.01,
        usage: { input: 12, output: 4, cacheRead: 3 },
      },
    ])
  })

  it('maps bash then write tool lifecycle without duplicating started', () => {
    const mapper = new ClaudeEventMapper()
    const events = [
      ...mapper.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_1', name: 'Bash', input: {} },
        },
      }),
      ...mapper.push({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"command":"echo ping"}' },
        },
      }),
      ...mapper.push({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'echo ping' },
          }],
        },
      }),
      ...mapper.push({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: 'ping',
          }],
        },
      }),
      ...mapper.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_2', name: 'Write' },
        },
      }),
      ...mapper.push({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'call_2',
            content: [{ type: 'text', text: 'Wrote z.txt' }],
          }],
        },
      }),
    ]

    expect(events).toEqual([
      { type: 'tool', event: 'started', id: 'call_1', name: 'bash', input: {} },
      { type: 'tool', event: 'input_delta', id: 'call_1', chunk: '{"command":"echo ping"}' },
      { type: 'tool', event: 'completed', id: 'call_1', name: 'bash', ok: true, output: 'ping' },
      { type: 'tool', event: 'started', id: 'call_2', name: 'write' },
      { type: 'tool', event: 'completed', id: 'call_2', name: 'write', ok: true, output: 'Wrote z.txt' },
    ])
  })

  it('maps an error result onto run.failed and keeps session stats', () => {
    const mapper = new ClaudeEventMapper()
    const events = mapper.push({
      type: 'result',
      subtype: 'error_during_execution',
      session_id: 'sess-err',
      is_error: true,
      duration_ms: 9,
      errors: ['boom'],
    })

    expect(events).toEqual([{
      type: 'run',
      event: 'failed',
      message: 'boom',
      sessionId: 'sess-err',
      harnessProvider: 'claude',
      model: 'unknown',
      durationMs: 9,
    }])
  })

  it('drops subagent assistant and user text from the main transcript', () => {
    const mapper = new ClaudeEventMapper()
    const events = [
      ...mapper.push({
        type: 'assistant',
        session_id: 'sess-1',
        parent_tool_use_id: 'agent-1',
        message: {
          content: [{ type: 'text', text: 'subagent only' }],
        },
      }),
      ...mapper.push({
        type: 'user',
        session_id: 'sess-1',
        parent_tool_use_id: 'agent-1',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'ok' }],
        },
      }),
      ...mapper.push({
        type: 'assistant',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          content: [{ type: 'text', text: 'main' }],
        },
      }),
    ]

    expect(events).toEqual([{ type: 'assistant', event: 'message', text: 'main' }])
  })
})
