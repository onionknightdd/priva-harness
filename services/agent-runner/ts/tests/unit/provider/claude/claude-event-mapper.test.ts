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
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        },
      }),
      ...mapper.push({
        type: 'assistant',
        session_id: 'sess-1',
        message: {
          id: 'msg_1',
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

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant.block_start', kind: 'text', index: 0 }),
      expect.objectContaining({ type: 'assistant.delta', text: 'Hello', index: 0 }),
      expect.objectContaining({
        type: 'assistant.message',
        messageId: 'msg_1',
        blocks: [expect.objectContaining({ type: 'text', text: 'Hello', index: 0 })],
      }),
      expect.objectContaining({
        type: 'run.completed',
        sessionId: 'sess-1',
        model: 'deepseek-v4-flash[1m]',
        durationMs: 42,
        costUsd: 0.01,
        usage: { input: 12, output: 4, cacheRead: 3 },
      }),
    ]))
    expect(events.some((event) => 'harnessProvider' in event)).toBe(false)
  })

  it('maps bash then write without duplicating tool.started', () => {
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
          id: 'msg_tools',
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

    const started = events.filter((event) => event.type === 'tool.started')
    expect(started).toEqual([
      expect.objectContaining({ id: 'call_1', name: 'bash' }),
      expect.objectContaining({ id: 'call_2', name: 'write' }),
    ])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool.input_delta', id: 'call_1', chunk: '{"command":"echo ping"}' }),
      expect.objectContaining({ type: 'tool.completed', id: 'call_1', name: 'bash', ok: true, output: 'ping' }),
      expect.objectContaining({ type: 'tool.completed', id: 'call_2', name: 'write', ok: true, output: 'Wrote z.txt' }),
    ]))
  })

  it('maps parallel tools that share a message id across split assistant snapshots', () => {
    const mapper = new ClaudeEventMapper()
    const events = [
      ...mapper.push({
        type: 'assistant',
        message: {
          id: 'msg_parallel',
          content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'echo a' } }],
        },
      }),
      ...mapper.push({
        type: 'assistant',
        message: {
          id: 'msg_parallel',
          content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'echo b' } }],
        },
      }),
    ]
    const snapshot = events.filter((event) => event.type === 'assistant.message').at(-1)
    expect(snapshot).toMatchObject({ type: 'assistant.message', messageId: 'msg_parallel' })
    if (snapshot?.type === 'assistant.message') {
      expect(snapshot.blocks.map((block) => block.type)).toEqual(['tool_use', 'tool_use'])
      expect(snapshot.blocks.map((block) => ('id' in block ? block.id : ''))).toEqual(['a', 'b'])
    }
  })

  it('keeps split thinking, text, and tool snapshots on one message id', () => {
    const mapper = new ClaudeEventMapper()
    const events = [
      ...mapper.push({
        type: 'assistant',
        message: {
          id: 'msg_split',
          content: [{ type: 'thinking', thinking: 'plan the sleeps' }],
        },
      }),
      ...mapper.push({
        type: 'assistant',
        message: {
          id: 'msg_split',
          content: [{ type: 'text', text: '先执行第一次：' }],
        },
      }),
      ...mapper.push({
        type: 'assistant',
        message: {
          id: 'msg_split',
          content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'sleep 5' } }],
        },
      }),
    ]
    const snapshot = events.filter((event) => event.type === 'assistant.message').at(-1)
    expect(snapshot?.type).toBe('assistant.message')
    if (snapshot?.type === 'assistant.message') {
      expect(snapshot.blocks.map((block) => block.type)).toEqual(['thinking', 'text', 'tool_use'])
      expect(
        snapshot.blocks.map((block) => {
          if (block.type === 'thinking' || block.type === 'text') return block.text
          if (block.type === 'tool_use') return block.id
          return block.blockId
        }),
      ).toEqual(['plan the sleeps', '先执行第一次：', 'bash-1'])
    }
  })

  it('keeps subagent assistant and user events on the parent channel', () => {
    const mapper = new ClaudeEventMapper()
    const events = [
      ...mapper.push({
        type: 'assistant',
        session_id: 'sess-1',
        parent_tool_use_id: 'agent-1',
        message: {
          id: 'msg_sub',
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
          id: 'msg_main',
          content: [{ type: 'text', text: 'main' }],
        },
      }),
    ]

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'assistant.message',
        messageId: 'msg_sub',
        parentToolUseId: 'agent-1',
      }),
      expect.objectContaining({
        type: 'tool.completed',
        id: 'call-1',
        parentToolUseId: 'agent-1',
        ok: true,
        output: 'ok',
      }),
      expect.objectContaining({
        type: 'assistant.message',
        messageId: 'msg_main',
      }),
    ]))
    const main = events.find((event) => event.type === 'assistant.message' && event.messageId === 'msg_main')
    expect(main).not.toHaveProperty('parentToolUseId')
  })

  it('routes workflow task_* separately from Agent/Task sidechains', () => {
    const mapper = new ClaudeEventMapper()
    const workflow = mapper.push({
      type: 'system',
      subtype: 'task_started',
      workflow_name: 'ship',
      tool_use_id: 'wf-1',
      task_id: 't1',
    } as Parameters<ClaudeEventMapper['push']>[0])
    const agent = mapper.push({
      type: 'system',
      subtype: 'task_started',
      subagent_type: 'Explore',
      agent_id: 'ag-1',
      tool_name: 'Agent',
    } as Parameters<ClaudeEventMapper['push']>[0])
    expect(workflow).toEqual([
      expect.objectContaining({ type: 'workflow.started', workflowToolUseId: 'wf-1', name: 'ship' }),
    ])
    expect(agent).toEqual([
      expect.objectContaining({ type: 'agent.started', agentId: 'ag-1', name: 'Explore' }),
    ])
  })

  it('marks Agent/Task first completion as async_launched when the result says so', () => {
    const mapper = new ClaudeEventMapper()
    mapper.push({
      type: 'assistant',
      message: {
        id: 'msg_agent',
        content: [{ type: 'tool_use', id: 'agent-call', name: 'Agent', input: { prompt: 'go' } }],
      },
    })
    const events = mapper.push({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'agent-call',
          content: '{"status":"async_launched","agentId":"ag-9"}',
          toolUseResult: { status: 'async_launched', agentId: 'ag-9' },
        }],
      },
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool.completed',
        id: 'agent-call',
        name: 'agent',
        ok: true,
        status: 'async_launched',
        agentId: 'ag-9',
      }),
    ]))
  })

  it('maps Edit tool_use_result.structuredPatch onto unified hunk output', () => {
    const mapper = new ClaudeEventMapper()
    mapper.push({
      type: 'assistant',
      message: {
        id: 'msg_edit',
        content: [{
          type: 'tool_use',
          id: 'edit_1',
          name: 'Edit',
          input: { file_path: 'a.ts', old_string: 'const a = 1', new_string: 'const a = 2' },
        }],
      },
    })
    const events = mapper.push({
      type: 'user',
      tool_use_result: {
        filePath: 'a.ts',
        oldString: 'const a = 1',
        newString: 'const a = 2',
        originalFile: null,
        structuredPatch: [{
          oldStart: 12,
          oldLines: 3,
          newStart: 12,
          newLines: 3,
          lines: [' keep', '-const a = 1', '+const a = 2'],
        }],
        userModified: false,
        replaceAll: false,
      },
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'edit_1',
          content: '     12\tkeep\n     13\tconst a = 2',
        }],
      },
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool.completed',
        id: 'edit_1',
        name: 'edit',
        ok: true,
        output: [
          '@@ -12,3 +12,3 @@',
          ' keep',
          '-const a = 1',
          '+const a = 2',
        ].join('\n'),
      }),
    ]))
  })

  it('maps Write gitDiff.patch when structuredPatch is empty', () => {
    const mapper = new ClaudeEventMapper()
    mapper.push({
      type: 'assistant',
      message: {
        id: 'msg_write',
        content: [{ type: 'tool_use', id: 'write_1', name: 'Write', input: { file_path: 'z.txt' } }],
      },
    })
    const events = mapper.push({
      type: 'user',
      tool_use_result: {
        type: 'create',
        filePath: 'z.txt',
        content: 'hello',
        structuredPatch: [],
        originalFile: null,
        gitDiff: {
          filename: 'z.txt',
          status: 'added',
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: '--- /dev/null\n+++ b/z.txt\n@@ -0,0 +1,1 @@\n+hello',
        },
      },
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'write_1', content: 'Wrote z.txt' }],
      },
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool.completed',
        id: 'write_1',
        name: 'write',
        output: '--- /dev/null\n+++ b/z.txt\n@@ -0,0 +1,1 @@\n+hello',
      }),
    ]))
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
      type: 'run.failed',
      message: 'boom',
      sessionId: 'sess-err',
      model: 'unknown',
      durationMs: 9,
    }])
  })
})
