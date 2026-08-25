import { describe, expect, it } from 'vitest'

import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import { replayClaudeSessionMessages } from '../../../../src/provider/claude/session/claude-thread-replay.js'
import type { SessionMessage } from '../../../../src/core/resource/session.js'
import type { ThreadBlock } from '../../../../src/core/resource/thread.js'

describe('replayClaudeSessionMessages', () => {
  it('folds user, tool result, nested agent, and async launch into one assistant turn', () => {
    const messages: SessionMessage[] = [
      session('user', 'u1', { role: 'user', content: 'ship it' }),
      session('assistant', 'a1', {
        role: 'assistant',
        id: 'a1',
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'tool_use', id: 'agent-1', name: 'Agent', input: { prompt: 'look' } },
          { type: 'tool_use', id: 'bash-1', name: 'bash', input: { command: 'ls' } },
        ],
      }),
      session('user', 't1', {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'agent-1',
            content: '{"status":"async_launched","agentId":"ag-9"}',
            toolUseResult: { status: 'async_launched', agentId: 'ag-9' },
          },
        ],
      }),
      session('user', 't2', {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: 'ok\n' }],
      }),
      session(
        'assistant',
        'nested-1',
        {
          role: 'assistant',
          id: 'nested-1',
          content: [
            { type: 'text', text: 'found it' },
            { type: 'tool_use', id: 'nested-bash', name: 'bash', input: { command: 'pwd' } },
          ],
        },
        'agent-1',
      ),
      session(
        'user',
        'nested-t',
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'nested-bash', content: '/tmp\n' }],
        },
        'agent-1',
      ),
      session('assistant', 'a2', {
        role: 'assistant',
        id: 'a2',
        content: [{ type: 'text', text: 'done' }],
      }),
    ]

    const thread = foldThread(replayClaudeSessionMessages(messages))
    expect(thread).toHaveLength(2)
    expect(thread[0]).toMatchObject({ role: 'user', content: 'ship it', transcriptUuid: 'u1' })

    const assistant = thread[1]
    expect(assistant?.role).toBe('assistant')
    expect(assistant?.content).toBe('done')
    expect(assistant?.transcriptUuid).toBe('a2')
    expect(assistant?.createdAt).toBe(new Date(1_700_000_000_000).toISOString())
    expect(assistant?.blocks?.some((block) => block.type === 'thinking')).toBe(true)

    const tools = assistant?.blocks?.filter((block) => block.type === 'tool_use') ?? []
    expect(tools.map((block) => block.id)).toEqual(['agent-1', 'bash-1'])
    expect(tools.some((block) => block.id === 'nested-bash')).toBe(false)
    const agentTool = tools.find((block) => block.id === 'agent-1')
    expect(agentTool?.type === 'tool_use' ? agentTool.tool?.launchStatus : undefined).toBe(
      'async_launched',
    )
    const bash = tools.find((block) => block.id === 'bash-1')
    expect(bash?.type === 'tool_use' ? bash.tool?.output : undefined).toBe('ok\n')

    expect(assistant?.nestedAgents).toEqual([
      expect.objectContaining({
        parentToolUseId: 'agent-1',
        agentId: 'ag-9',
        status: 'running',
      }),
    ])
    const nestedBlocks = assistant?.nestedAgents?.[0]?.blocks ?? []
    const nestedText = nestedBlocks.find((block) => block.type === 'text')
    expect(nestedText?.type === 'text' ? nestedText.text : undefined).toBe('found it')
    const nestedBash = nestedBlocks.find((block) => block.type === 'tool_use' && block.id === 'nested-bash')
    expect(nestedBash?.type === 'tool_use' ? nestedBash.tool?.output : undefined).toBe('/tmp\n')
  })

  it('keeps thinking and inter-tool text from split Claude bash snapshots', () => {
    const messages: SessionMessage[] = [
      session('user', 'u1', { role: 'user', content: '执行3次bash 工具，每次sleep 5s' }),
      session('assistant', 'a1-think', {
        role: 'assistant',
        id: '1744a41d',
        content: [{ type: 'thinking', thinking: 'The user asked for three bash sleeps.' }],
      }),
      session('assistant', 'a1-text', {
        role: 'assistant',
        id: '1744a41d',
        content: [{ type: 'text', text: '我来执行 3 次 bash 工具调用，每次 sleep 5 秒。先执行第一次：' }],
      }),
      session('assistant', 'a1-tool', {
        role: 'assistant',
        id: '1744a41d',
        content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'sleep 5' } }],
      }),
      session('user', 't1', {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: '第 1 次完成' }],
      }),
      session('assistant', 'a2-think', {
        role: 'assistant',
        id: '3c42e957',
        content: [{ type: 'thinking', thinking: '' }],
      }),
      session('assistant', 'a2-text', {
        role: 'assistant',
        id: '3c42e957',
        content: [{ type: 'text', text: '第一次完成。现在执行第二次：' }],
      }),
      session('assistant', 'a2-tool', {
        role: 'assistant',
        id: '3c42e957',
        content: [{ type: 'tool_use', id: 'bash-2', name: 'Bash', input: { command: 'sleep 5' } }],
      }),
      session('user', 't2', {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'bash-2', content: '第 2 次完成' }],
      }),
      session('assistant', 'a3-think', {
        role: 'assistant',
        id: '6bc937dd',
        content: [{ type: 'thinking', thinking: '' }],
      }),
      session('assistant', 'a3-text', {
        role: 'assistant',
        id: '6bc937dd',
        content: [{ type: 'text', text: '第二次完成。现在执行第三次：' }],
      }),
      session('assistant', 'a3-tool', {
        role: 'assistant',
        id: '6bc937dd',
        content: [{ type: 'tool_use', id: 'bash-3', name: 'Bash', input: { command: 'sleep 5' } }],
      }),
      session('user', 't3', {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'bash-3', content: '第 3 次完成' }],
      }),
      session('assistant', 'a4-think', {
        role: 'assistant',
        id: 'cc035c31',
        content: [{ type: 'thinking', thinking: '' }],
      }),
      session('assistant', 'a4-text', {
        role: 'assistant',
        id: 'cc035c31',
        content: [{ type: 'text', text: '已完成 3 次 bash 工具调用' }],
      }),
    ]

    const thread = foldThread(replayClaudeSessionMessages(messages))
    expect(thread).toHaveLength(2)
    const assistant = thread[1]
    expect(assistant?.content).toBe('已完成 3 次 bash 工具调用')
    expect(
      assistant?.blocks
        ?.filter((block): block is Extract<ThreadBlock, { type: 'thinking' }> => block.type === 'thinking')
        .map((block) => block.text),
    ).toEqual(['The user asked for three bash sleeps.'])
    expect(
      assistant?.blocks
        ?.filter((block): block is Extract<ThreadBlock, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text),
    ).toEqual([
      '我来执行 3 次 bash 工具调用，每次 sleep 5 秒。先执行第一次：',
      '第一次完成。现在执行第二次：',
      '第二次完成。现在执行第三次：',
      '已完成 3 次 bash 工具调用',
    ])
    expect(
      assistant?.blocks
        ?.filter((block): block is Extract<ThreadBlock, { type: 'tool_use' }> => block.type === 'tool_use')
        .map((block) => block.id),
    ).toEqual(['bash-1', 'bash-2', 'bash-3'])
    expect(assistant?.blocks?.map((block) => block.type)).toEqual([
      'thinking',
      'text',
      'tool_use',
      'text',
      'tool_use',
      'text',
      'tool_use',
      'text',
    ])
  })

  it('stamps thinking duration when stream_event timestamps differ', () => {
    const start = 1_700_000_000_000
    const messages: SessionMessage[] = [
      session('user', 'u1', { role: 'user', content: 'think' }, null, start),
      session(
        'stream_event',
        's1',
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'hmm' },
        },
        null,
        start + 1_000,
      ),
      session(
        'stream_event',
        's2',
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: ' more' },
        },
        null,
        start + 4_000,
      ),
      session(
        'assistant',
        'a1',
        {
          role: 'assistant',
          id: 'a1',
          content: [
            { type: 'thinking', thinking: 'hmm more' },
            { type: 'text', text: 'done' },
          ],
        },
        null,
        start + 5_000,
      ),
    ]

    const thread = foldThread(replayClaudeSessionMessages(messages))
    const thinking = thread[1]?.blocks?.find((block) => block.type === 'thinking')
    expect(thinking).toMatchObject({
      type: 'thinking',
      text: 'hmm more',
      startedAt: start + 1_000,
      durationMs: 4_000,
    })
  })

  it('replays Edit structuredPatch as unified hunk output with file line numbers', () => {
    const messages: SessionMessage[] = [
      session('assistant', 'a1', {
        role: 'assistant',
        id: 'a1',
        content: [{
          type: 'tool_use',
          id: 'edit-1',
          name: 'Edit',
          input: { file_path: 'a.ts', old_string: 'a', new_string: 'b' },
        }],
      }),
      session('user', 't1', {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: '     12\tkeep' }],
        tool_use_result: {
          structuredPatch: [{
            oldStart: 12,
            oldLines: 1,
            newStart: 12,
            newLines: 1,
            lines: [' keep'],
          }],
        },
      }),
    ]
    const thread = foldThread(replayClaudeSessionMessages(messages))
    const tool = thread[0]?.blocks?.find((block) => block.type === 'tool_use')
    expect(tool).toMatchObject({
      id: 'edit-1',
      name: 'edit',
      tool: { status: 'completed', ok: true, output: '@@ -12,1 +12,1 @@\n keep' },
    })
  })
})

function session(
  type: SessionMessage['type'],
  uuid: string,
  message: unknown,
  parentToolUseId: string | null = null,
  timestamp = 1_700_000_000_000,
): SessionMessage {
  return {
    type,
    uuid,
    sessionId: 'sess-1',
    message,
    parentToolUseId,
    metadata: null,
    timestamp,
  }
}
