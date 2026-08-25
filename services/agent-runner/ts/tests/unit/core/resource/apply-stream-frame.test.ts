import { describe, expect, it } from 'vitest'

import { applyStreamFrame, emptyAssistantMessage } from '../../../../src/core/resource/apply-stream-frame.js'
import type { ThreadBlock } from '../../../../src/core/resource/thread.js'

describe('applyStreamFrame', () => {
  it('keeps nested tool frames off the main assistant blocks', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'tool.started',
      messageId: 'a1',
      blockId: 'agent-1',
      index: 0,
      id: 'agent-1',
      name: 'agent',
    })
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'nested-1',
      parentToolUseId: 'agent-1',
      blocks: [{ type: 'text', blockId: 'nested-1:0', index: 0, text: 'hi' }],
    })
    message = applyStreamFrame(message, {
      type: 'tool.started',
      messageId: 'nested-1',
      blockId: 'nested-bash',
      index: 1,
      id: 'nested-bash',
      name: 'bash',
      parentToolUseId: 'agent-1',
    })

    expect(toolIds(message.blocks)).toEqual(['agent-1'])
    expect(toolIds(message.nestedAgents?.[0]?.blocks)).toEqual(['nested-bash'])
    expect(message.content).toBe('')
  })

  it('stamps transcriptUuid from a main-channel assistant.message', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a2',
      blocks: [{ type: 'text', blockId: 'a2:0', index: 0, text: 'done' }],
    })
    expect(message.transcriptUuid).toBe('a2')
    expect(message.content).toBe('done')
  })

  it('keeps earlier thinking when a later snapshot has empty thinking', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a1',
      blocks: [{ type: 'thinking', blockId: 'a1:0', index: 0, text: 'plan the bash calls' }],
    })
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a2',
      blocks: [{ type: 'thinking', blockId: 'a2:0', index: 0, text: '' }],
    })

    expect(message.blocks).toEqual([
      expect.objectContaining({ type: 'thinking', text: 'plan the bash calls' }),
    ])
  })

  it('accumulates split assistant snapshots in arrival order when indices collide', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a1',
      blocks: [{ type: 'thinking', blockId: 'a1:0', index: 0, text: 'plan' }],
    })
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a1',
      blocks: [{ type: 'text', blockId: 'a1:1', index: 0, text: '先执行第一次：' }],
    })
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a1',
      blocks: [
        {
          type: 'tool_use',
          blockId: 'bash-1',
          index: 0,
          id: 'bash-1',
          name: 'bash',
        },
      ],
    })
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a2',
      blocks: [{ type: 'thinking', blockId: 'a2:0', index: 0, text: '' }],
    })
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a2',
      blocks: [{ type: 'text', blockId: 'a2:1', index: 0, text: '第一次完成。现在执行第二次：' }],
    })
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a2',
      blocks: [
        {
          type: 'tool_use',
          blockId: 'bash-2',
          index: 0,
          id: 'bash-2',
          name: 'bash',
        },
      ],
    })
    expect(message.content).toBe('')

    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a3',
      blocks: [{ type: 'text', blockId: 'a3:0', index: 0, text: '已完成 3 次 bash 工具调用' }],
    })

    expect(message.blocks?.map((block) => block.type)).toEqual([
      'thinking',
      'text',
      'tool_use',
      'text',
      'tool_use',
      'text',
    ])
    expect(texts(message.blocks)).toEqual([
      '先执行第一次：',
      '第一次完成。现在执行第二次：',
      '已完成 3 次 bash 工具调用',
    ])
    expect(toolIds(message.blocks)).toEqual(['bash-1', 'bash-2'])
    expect(message.content).toBe('已完成 3 次 bash 工具调用')
  })

  it('keeps snapshot text before a tool that already started', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'tool.started',
      messageId: 'a1',
      blockId: 'bash-1',
      index: 0,
      id: 'bash-1',
      name: 'bash',
    })
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a1',
      blocks: [
        { type: 'text', blockId: 'a1:0', index: 0, text: '先执行第一次：' },
        { type: 'tool_use', blockId: 'bash-1', index: 1, id: 'bash-1', name: 'bash' },
      ],
    })

    expect(message.blocks?.map((block) => block.type)).toEqual(['text', 'tool_use'])
    expect(texts(message.blocks)).toEqual(['先执行第一次：'])
    expect(message.content).toBe('')
  })

  it('does not insert a second thinking row from a later snapshot', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a1',
      blocks: [
        { type: 'thinking', blockId: 'a1:0', index: 0, text: 'plan the bash calls' },
        { type: 'text', blockId: 'a1:1', index: 1, text: '第一次：' },
        { type: 'tool_use', blockId: 'bash-1', index: 2, id: 'bash-1', name: 'bash' },
      ],
    })
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'a2',
      blocks: [
        { type: 'thinking', blockId: 'a2:0', index: 0, text: 'plan the bash calls' },
        { type: 'text', blockId: 'a2:1', index: 1, text: '第二次：' },
        { type: 'tool_use', blockId: 'bash-2', index: 2, id: 'bash-2', name: 'bash' },
      ],
    })

    expect(message.blocks?.map((block) => block.type)).toEqual([
      'thinking',
      'text',
      'tool_use',
      'text',
      'tool_use',
    ])
    expect(
      message.blocks
        ?.filter((block): block is Extract<ThreadBlock, { type: 'thinking' }> => block.type === 'thinking')
        .map((block) => block.text),
    ).toEqual(['plan the bash calls'])
  })

  it('replaces empty tool.started input when tool.updated has the command', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'tool.started',
      messageId: 'a1',
      blockId: 'bash-1',
      index: 0,
      id: 'bash-1',
      name: 'bash',
      input: {},
    })
    message = applyStreamFrame(message, {
      type: 'tool.updated',
      messageId: 'a1',
      blockId: 'bash-1',
      index: 0,
      id: 'bash-1',
      name: 'bash',
      input: { command: 'sleep 5', description: 'Wait 5 seconds' },
    })

    expect(toolInput(message.blocks, 'bash-1')).toEqual({
      command: 'sleep 5',
      description: 'Wait 5 seconds',
    })
  })

  it('parses bash command from tool.input_delta chunks while streaming', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'tool.started',
      messageId: 'a1',
      blockId: 'bash-1',
      index: 0,
      id: 'bash-1',
      name: 'bash',
      input: {},
    })
    message = applyStreamFrame(message, {
      type: 'tool.input_delta',
      messageId: 'a1',
      blockId: 'bash-1',
      index: 0,
      id: 'bash-1',
      chunk: '{"command":',
    })
    expect(toolInput(message.blocks, 'bash-1')).toEqual({})

    message = applyStreamFrame(message, {
      type: 'tool.input_delta',
      messageId: 'a1',
      blockId: 'bash-1',
      index: 0,
      id: 'bash-1',
      chunk: '"sleep 5"',
    })
    expect(toolInput(message.blocks, 'bash-1')).toEqual({ command: 'sleep 5' })

    message = applyStreamFrame(message, {
      type: 'tool.input_delta',
      messageId: 'a1',
      blockId: 'bash-1',
      index: 0,
      id: 'bash-1',
      chunk: '}',
    })
    expect(toolInput(message.blocks, 'bash-1')).toEqual({ command: 'sleep 5' })
  })

  it('exposes a partial bash command before the JSON string closes', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'tool.started',
      messageId: 'a1',
      blockId: 'bash-1',
      index: 0,
      id: 'bash-1',
      name: 'bash',
      input: {},
    })
    message = applyStreamFrame(message, {
      type: 'tool.input_delta',
      messageId: 'a1',
      blockId: 'bash-1',
      index: 0,
      id: 'bash-1',
      chunk: '{"command":"sl',
    })
    expect(toolInput(message.blocks, 'bash-1')).toEqual({ command: 'sl' })

    message = applyStreamFrame(message, {
      type: 'tool.input_delta',
      messageId: 'a1',
      blockId: 'bash-1',
      index: 0,
      id: 'bash-1',
      chunk: 'eep 5"}',
    })
    expect(toolInput(message.blocks, 'bash-1')).toEqual({ command: 'sleep 5' })
  })

  it('exposes a partial Write path and content from tool.input_delta', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'tool.started',
      messageId: 'a1',
      blockId: 'write-1',
      index: 0,
      id: 'write-1',
      name: 'Write',
      input: {},
    })
    message = applyStreamFrame(message, {
      type: 'tool.input_delta',
      messageId: 'a1',
      blockId: 'write-1',
      index: 0,
      id: 'write-1',
      chunk: '{"file_path":"src/app.ts","content":"expor',
    })
    expect(toolInput(message.blocks, 'write-1')).toEqual({
      file_path: 'src/app.ts',
      content: 'expor',
    })

    message = applyStreamFrame(message, {
      type: 'tool.input_delta',
      messageId: 'a1',
      blockId: 'write-1',
      index: 0,
      id: 'write-1',
      chunk: 't const n = 1\\n"}',
    })
    expect(toolInput(message.blocks, 'write-1')).toEqual({
      file_path: 'src/app.ts',
      content: 'export const n = 1\n',
    })
  })

  it('exposes a partial Edit path and replacement from tool.input_delta', () => {
    let message = emptyAssistantMessage('a1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'tool.started',
      messageId: 'a1',
      blockId: 'edit-1',
      index: 0,
      id: 'edit-1',
      name: 'Edit',
      input: {},
    })
    message = applyStreamFrame(message, {
      type: 'tool.input_delta',
      messageId: 'a1',
      blockId: 'edit-1',
      index: 0,
      id: 'edit-1',
      chunk: '{"file_path":"src/app.ts","old_string":"const a = 1","new_string":"const a',
    })
    expect(toolInput(message.blocks, 'edit-1')).toEqual({
      file_path: 'src/app.ts',
      old_string: 'const a = 1',
      new_string: 'const a',
    })

    message = applyStreamFrame(message, {
      type: 'tool.input_delta',
      messageId: 'a1',
      blockId: 'edit-1',
      index: 0,
      id: 'edit-1',
      chunk: ' = 2"}',
    })
    expect(toolInput(message.blocks, 'edit-1')).toEqual({
      file_path: 'src/app.ts',
      old_string: 'const a = 1',
      new_string: 'const a = 2',
    })
  })

  it('does not duplicate answer text when a snapshot reuses a different block id', () => {
    let message = emptyAssistantMessage('msg_1', '2024-01-01T00:00:00.000Z')
    message = applyStreamFrame(message, {
      type: 'assistant.thinking_delta',
      messageId: 'msg_1',
      blockId: 'msg_1:0',
      index: 0,
      text: 'hmm',
    })
    message = applyStreamFrame(message, {
      type: 'assistant.delta',
      messageId: 'msg_1',
      blockId: 'msg_1:1',
      index: 1,
      text: 'Hi! What can I help you with today?',
    })
    message = applyStreamFrame(message, {
      type: 'assistant.message',
      messageId: 'msg_1',
      blocks: [
        { type: 'thinking', blockId: 'msg:0', index: 0, text: 'hmm' },
        { type: 'text', blockId: 'msg:1', index: 1, text: 'Hi! What can I help you with today?' },
      ],
    })
    expect(texts(message.blocks)).toEqual(['Hi! What can I help you with today?'])
    expect(message.content).toBe('Hi! What can I help you with today?')
  })
})

function toolIds(blocks: readonly ThreadBlock[] | undefined): string[] {
  return (blocks ?? [])
    .filter((block): block is Extract<ThreadBlock, { type: 'tool_use' }> => block.type === 'tool_use')
    .map((block) => block.id)
}

function texts(blocks: readonly ThreadBlock[] | undefined): string[] {
  return (blocks ?? [])
    .filter((block): block is Extract<ThreadBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
}

function toolInput(
  blocks: readonly ThreadBlock[] | undefined,
  id: string,
): unknown {
  const block = (blocks ?? []).find(
    (item): item is Extract<ThreadBlock, { type: 'tool_use' }> =>
      item.type === 'tool_use' && item.id === id,
  )
  return block?.tool?.input ?? block?.input
}
