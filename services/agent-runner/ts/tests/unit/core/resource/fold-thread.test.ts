import { describe, expect, it } from 'vitest'

import type { AgentEvent, ContentBlock } from '../../../../src/core/event/agent-event.js'
import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import type { ThreadReplayItem } from '../../../../src/core/resource/thread.js'

describe('foldThread', () => {
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
