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
})

function toolIds(blocks: readonly ThreadBlock[] | undefined): string[] {
  return (blocks ?? [])
    .filter((block): block is Extract<ThreadBlock, { type: 'tool_use' }> => block.type === 'tool_use')
    .map((block) => block.id)
}
