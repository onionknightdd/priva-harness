import { describe, expect, it } from 'vitest'

import type { AgentEvent, ContentBlock } from '../../../../src/core/event/agent-event.js'
import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import type { ThreadReplayItem } from '../../../../src/core/resource/thread.js'

describe('foldThread', () => {
  it('attaches replayed question resolutions to their tool owner across turns', () => {
    const resolution = { request: { kind: 'question' as const, requestId: 'history:ask-1', tool: 'AskUserQuestion', toolUseId: 'ask-1', questions: [{ id: 'q0', question: 'Which region?', options: [], multiSelect: false }], expiresAt: 0 }, decision: 'allow' as const, reason: 'answered' as const, answers: { q0: { selected: [], text: 'Asia' } } }
    const thread = foldThread([
      user('u1', 'first'),
      frame({ type: 'assistant.message', messageId: 'a1', blocks: [toolUse('ask-1', 'AskUserQuestion', 0)] }),
      user('u2', 'second'),
      frame({ type: 'assistant.message', messageId: 'a2', blocks: [textBlock('next turn', 'text-2', 0)] }),
      frame({ type: 'permission.resolved', resolution }),
      frame({ type: 'permission.resolved', resolution }),
    ])
    expect(thread[1]?.interactions).toEqual([resolution])
    expect(thread[3]?.interactions).toBeUndefined()
  })

  it('attaches nested frames that arrive after the next user turn', () => {
    const thread = foldThread([
      user('u1', 'first'),
      frame({
        type: 'assistant.message',
        messageId: 'a1',
        blocks: [toolUse('agent-1', 'agent', 0)],
      }),
      frame({
        type: 'tool.started',
        messageId: 'a1',
        blockId: 'agent-1',
        index: 0,
        id: 'agent-1',
        name: 'agent',
      }),
      user('u2', 'second'),
      frame({
        type: 'assistant.message',
        messageId: 'nested-1',
        parentToolUseId: 'agent-1',
        blocks: [
          textBlock('found it', 'nested-1:0', 0),
          toolUse('nested-bash', 'bash', 1),
        ],
      }),
      frame({
        type: 'tool.started',
        messageId: 'nested-1',
        blockId: 'nested-bash',
        index: 1,
        id: 'nested-bash',
        name: 'bash',
        parentToolUseId: 'agent-1',
      }),
    ])

    expect(thread.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    const assistant = thread[1]
    expect(mainToolIds(assistant)).toEqual(['agent-1'])
    expect(nestedToolIds(assistant, 'agent-1')).toEqual(['nested-bash'])
    expect(thread[2]?.nestedAgents).toBeUndefined()
  })

  it('keeps thinking and tools when a later snapshot is text-only', () => {
    const thread = foldThread([
      user('u1', 'ship it'),
      frame({
        type: 'assistant.thinking_delta',
        messageId: 'a1',
        blockId: 'think',
        index: 0,
        text: 'plan',
      }),
      frame({
        type: 'tool.started',
        messageId: 'a1',
        blockId: 'bash-1',
        index: 1,
        id: 'bash-1',
        name: 'bash',
      }),
      frame({
        type: 'assistant.message',
        messageId: 'a2',
        blocks: [textBlock('done', 'a2:0', 2)],
      }),
    ])

    const assistant = thread[1]
    expect(assistant?.content).toBe('done')
    expect(assistant?.transcriptUuid).toBe('a2')
    expect(assistant?.blocks?.some((block) => block.type === 'thinking')).toBe(true)
    expect(mainToolIds(assistant)).toEqual(['bash-1'])
  })

  it('does not treat async_launched nested agents as complete', () => {
    const thread = foldThread([
      user('u1', 'delegate'),
      frame({
        type: 'assistant.message',
        messageId: 'a1',
        blocks: [toolUse('agent-1', 'agent', 0)],
      }),
      frame({
        type: 'tool.completed',
        id: 'agent-1',
        name: 'agent',
        ok: true,
        output: '{"status":"async_launched"}',
        status: 'async_launched',
        agentId: 'ag-9',
        messageId: 'a1',
        blockId: 'agent-1',
      }),
      frame({
        type: 'assistant.message',
        messageId: 'nested-1',
        parentToolUseId: 'agent-1',
        blocks: [textBlock('still working', 'nested-1:0', 0)],
      }),
      frame({
        type: 'tool.completed',
        id: 'agent-1',
        name: 'agent',
        ok: true,
        output: '{"status":"async_launched"}',
        status: 'async_launched',
        parentToolUseId: 'agent-1',
        agentId: 'ag-9',
        messageId: 'nested-1',
        blockId: 'agent-1',
      }),
    ])

    const assistant = thread[1]
    const agentTool = assistant?.blocks?.find((block) => block.type === 'tool_use')
    expect(agentTool?.type === 'tool_use' ? agentTool.tool?.launchStatus : undefined).toBe(
      'async_launched',
    )
    expect(assistant?.nestedAgents?.[0]).toMatchObject({
      parentToolUseId: 'agent-1',
      status: 'running',
    })
  })

  it('pairs a Claude continuation summary onto the compact command', () => {
    const thread = foldThread([
      user(
        's1',
        'This session is being continued from a previous conversation that ran out of context.\n\nSummary:\nKept the tokens.',
      ),
      user('c1', '/compact'),
      user('o1', '<local-command-stdout>Compacted </local-command-stdout>'),
    ])

    expect(thread).toEqual([
      expect.objectContaining({
        role: 'user',
        content: '/compact',
        compact: { phase: 'compacted', summary: 'Kept the tokens.' },
      }),
    ])
  })

  it('applies live compact events onto the compact user', () => {
    const thread = foldThread([
      user('c1', '/compact'),
      frame({ type: 'session.compacting' }),
      frame({ type: 'session.compacted', summary: 'Probe tokens confirmed.' }),
    ])

    expect(thread[0]).toMatchObject({
      compact: { phase: 'compacted', summary: 'Probe tokens confirmed.' },
    })
  })

  it('keeps automatic compaction below the latest answer without changing an earlier compact marker', () => {
    const thread = foldThread([
      user('old', '/compact'),
      frame({ type: 'session.compacted', summary: 'Old summary' }),
      user('next', 'Continue'),
      frame({ type: 'assistant.message', messageId: 'answer', blocks: [textBlock('Latest answer', 'answer:0', 0)] }),
      frame({ type: 'session.compacting', reason: 'auto' }),
      frame({ type: 'session.compacted', reason: 'auto', summary: 'New summary' }),
    ])
    expect(thread.map((message) => message.content)).toEqual(['/compact', 'Continue', 'Latest answer', '/compact'])
    expect(thread[0]?.compact).toEqual({ phase: 'compacted', summary: 'Old summary' })
    expect(thread[3]?.compact).toEqual({ phase: 'compacted', summary: 'New summary' })
    expect(thread[3]?.id).not.toBe('old')
    expect(foldThread([
      user('next', 'Continue'),
      frame({ type: 'session.compacted' }),
    ]).at(-1)?.compact).toEqual({ phase: 'compacted' })
  })

  it('pairs summaries on either side of their command and does not carry one across a normal turn', () => {
    const summary = (id: string, text: string) => user(id,
      `This session is being continued from a previous conversation.\n\nSummary:\n${text}`)
    const thread = foldThread([
      user('first-command', '/compact first'),
      frame({ type: 'session.compacted' }),
      summary('first-summary', 'First'),
      user('next', 'Continue'),
      summary('automatic-summary', 'Automatic'),
      user('another', 'Continue again'),
      summary('second-summary', 'Second'),
      user('second-command', '/compact second'),
      user('stdout', '<local-command-stdout>Compacted</local-command-stdout>'),
      user('third-command', '/compact third'),
    ])
    const compacts = thread.filter((message) => message.compact)
    expect(compacts.map((message) => message.compact)).toEqual([
      { phase: 'compacted', summary: 'First' },
      { phase: 'compacted', summary: 'Automatic' },
      { phase: 'compacted', summary: 'Second' },
      { phase: 'queued' },
    ])
    expect(compacts.map((message) => message.id)).toEqual(['first-command', expect.stringContaining('automatic-summary'), 'second-command', 'third-command'])
  })

  it.each(['session.compaction_failed', 'session.compaction_cancelled'] as const)('keeps %s on its current marker and permits subsequent replies', (type) => {
    const thread = foldThread([
      user('prompt', 'Continue'),
      frame({ type: 'session.compacting', reason: 'auto' }),
      frame({ type, message: 'Compaction stopped', reason: 'auto' }),
      frame({ type: 'assistant.message', messageId: 'answer', blocks: [textBlock('Still answering', 'answer:0', 0)] }),
    ])
    expect(thread.map((message) => message.content)).toEqual(['Continue', '/compact', 'Still answering'])
    expect(thread[1]?.compact).toEqual({ phase: type === 'session.compaction_failed' ? 'failed' : 'cancelled', message: 'Compaction stopped' })
    expect(thread[2]?.status).toBe('complete')
  })

  it('cancels only the active compact marker when a run is aborted', () => {
    const thread = foldThread([
      user('done', '/compact'),
      frame({ type: 'session.compacted', summary: 'Done' }),
      user('pending', '/compact'),
      frame({ type: 'session.compacting' }),
      frame({ type: 'run.aborted' }),
    ])
    expect(thread[0]?.compact).toEqual({ phase: 'compacted', summary: 'Done' })
    expect(thread[1]?.compact).toEqual({ phase: 'cancelled' })
  })

  it('marks the compact user failed when the run fails', () => {
    const thread = foldThread([
      user('c1', '/compact'),
      frame({ type: 'session.compacting' }),
      frame({ type: 'run.failed', message: 'Nothing to compact (session too small)' }),
    ])

    expect(thread).toEqual([
      expect.objectContaining({
        role: 'user',
        content: '/compact',
        compact: { phase: 'failed' },
      }),
      expect.objectContaining({
        role: 'assistant',
        status: 'error',
        content: 'Nothing to compact (session too small)',
      }),
    ])
  })

  it('does not fail an already compacted user on a later error', () => {
    const thread = foldThread([
      user('c1', '/compact'),
      frame({ type: 'session.compacted', summary: 'Kept the tokens.' }),
      user('u2', 'what next'),
      frame({ type: 'run.failed', message: 'later blowup' }),
    ])

    expect(thread[0]).toMatchObject({
      compact: { phase: 'compacted', summary: 'Kept the tokens.' },
    })
    expect(thread.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'error',
      content: 'later blowup',
    })
  })

  it('drops the synthetic No response requested assistant', () => {
    const thread = foldThread([
      user('u1', '/compact'),
      frame({
        type: 'assistant.message',
        messageId: 'a1',
        blocks: [textBlock('No response requested.', 'a1:0', 0)],
      }),
    ])

    expect(thread).toEqual([
      expect.objectContaining({ role: 'user', content: '/compact' }),
    ])
  })

  it('keeps the real last answer when a No response requested trailer is folded in', () => {
    const thread = foldThread([
      user('u1', '写完了吗'),
      frame({
        type: 'assistant.message',
        messageId: 'a1',
        blocks: [textBlock('已经写完。', 'a1:0', 0)],
      }),
      frame({
        type: 'assistant.message',
        messageId: 'a2',
        blocks: [textBlock('No response requested.', 'a2:0', 0)],
      }),
    ])

    expect(thread.at(-1)).toMatchObject({
      role: 'assistant',
      content: '已经写完。',
    })
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

function frame(event: AgentEvent): ThreadReplayItem {
  return { kind: 'frame', event, createdAt: '2024-01-01T00:00:01.000Z' }
}

function textBlock(text: string, blockId: string, index: number): ContentBlock {
  return { type: 'text', blockId, index, text }
}

function toolUse(id: string, name: string, index: number): ContentBlock {
  return { type: 'tool_use', blockId: id, index, id, name }
}

function mainToolIds(message: { blocks?: readonly { type: string; id?: string }[] } | undefined) {
  return (message?.blocks ?? [])
    .filter((block) => block.type === 'tool_use')
    .map((block) => block.id)
}

function nestedToolIds(
  message:
    | {
        nestedAgents?: readonly {
          parentToolUseId: string
          blocks: readonly { type: string; id?: string }[]
        }[]
      }
    | undefined,
  parentToolUseId: string,
) {
  const agent = message?.nestedAgents?.find((item) => item.parentToolUseId === parentToolUseId)
  return (agent?.blocks ?? [])
    .filter((block) => block.type === 'tool_use')
    .map((block) => block.id)
}
