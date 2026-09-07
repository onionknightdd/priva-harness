import { describe, expect, it } from 'vitest'
import { applyStreamFrame, emptyAssistantMessage } from '../../../../src/core/resource/apply-stream-frame.js'

function runningAgent() {
  return applyStreamFrame(emptyAssistantMessage('main', '2024-01-01T00:00:00Z'), {
    type: 'assistant.message', messageId: 'nested', parentToolUseId: 'parent', agentId: 'worker',
    blocks: [{ type: 'thinking', blockId: 'thought', index: 0, text: 'Check the files' }],
  })
}

describe('Agent view state', () => {
  it('does not finish the parent when its child Agent tool finishes', () => {
    const result = applyStreamFrame(runningAgent(), { type: 'tool.completed', messageId: 'nested', parentToolUseId: 'parent', id: 'child', name: 'agent', ok: true, output: 'done' })
    expect(result.nestedAgents?.[0]?.status).toBe('running')
    expect(result.nestedAgents?.[0]?.blocks.some((block) => block.type === 'tool_use' && block.id === 'child')).toBe(true)
  })
  it('keeps asynchronous launches running and records the actual terminal outcome', () => {
    const launched = applyStreamFrame(runningAgent(), { type: 'tool.completed', messageId: 'main', id: 'parent', name: 'agent', ok: true, status: 'async_launched', agentId: 'worker', output: 'launched' })
    expect(launched.nestedAgents?.[0]?.status).toBe('running')
    expect(applyStreamFrame(launched, { type: 'agent.completed', agentId: 'worker', ok: false }).nestedAgents?.[0]?.status).toBe('failed')
    expect(applyStreamFrame(launched, { type: 'agent.completed', agentId: 'worker', status: 'cancelled' }).nestedAgents?.[0]?.status).toBe('cancelled')
  })
  it('places delivered communication after the blocks already received', () => {
    const result = applyStreamFrame(runningAgent(), { type: 'agent.message', direction: 'received', parentToolUseId: 'parent', source: 'peer', body: 'Check cancellation' })
    expect(result.nestedAgents?.[0]?.inbox[0]).toMatchObject({ body: 'Check cancellation', afterBlockCount: 1 })
  })
  it('deduplicates the same delivery but keeps repeated text with a different receipt ID', () => {
    const event = { type: 'agent.message' as const, direction: 'received' as const, parentToolUseId: 'parent', source: 'peer' as const, body: 'Review', deliveryId: 'receipt-1' }
    const first = applyStreamFrame(runningAgent(), event)
    expect(applyStreamFrame(first, event).nestedAgents?.[0]?.inbox).toHaveLength(1)
    expect(applyStreamFrame(first, { ...event, deliveryId: 'receipt-2' }).nestedAgents?.[0]?.inbox).toHaveLength(2)
  })

})
