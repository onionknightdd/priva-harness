import { describe, expect, it } from 'vitest'

import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import { replayClaudeSessionMessages } from '../../../../src/provider/claude/session/claude-thread-replay.js'
import type { SessionMessage } from '../../../../src/core/resource/session.js'

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
})

function session(
  type: SessionMessage['type'],
  uuid: string,
  message: unknown,
  parentToolUseId: string | null = null,
): SessionMessage {
  return {
    type,
    uuid,
    sessionId: 'sess-1',
    message,
    parentToolUseId,
    metadata: null,
    timestamp: 1_700_000_000_000,
  }
}
