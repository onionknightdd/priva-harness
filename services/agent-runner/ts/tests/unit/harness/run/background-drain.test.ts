import { describe, expect, it } from 'vitest'

import { BackgroundDrainTracker, isAgentName, isWorkflowName } from '../../../../src/harness/run/background-drain.js'

describe('BackgroundDrainTracker', () => {
  it('treats Agent/Task as agents and Workflow as workflow', () => {
    expect(isAgentName('Agent')).toBe(true)
    expect(isAgentName('task')).toBe(true)
    expect(isWorkflowName('Workflow')).toBe(true)
    expect(isWorkflowName('Agent')).toBe(false)
  })

  it('keeps the stream open after run.completed while a workflow is outstanding', () => {
    const drain = new BackgroundDrainTracker({ idleMs: 1_000, settleMs: 50, now: () => 0 })
    drain.observe({ type: 'tool.started', id: 'wf-1', name: 'workflow', messageId: 'm', blockId: 'wf-1', index: 0 })
    drain.observe({ type: 'workflow.started', workflowToolUseId: 'wf-1' })
    expect(drain.hasOutstanding()).toBe(true)
    expect(drain.shouldClose(true)).toBe(false)
  })

  it('does not treat async_launched Agent/Task as terminal', () => {
    const drain = new BackgroundDrainTracker({ idleMs: 1_000, settleMs: 50, now: () => 0 })
    drain.observe({
      type: 'tool.completed',
      id: 'call-a',
      name: 'agent',
      ok: true,
      output: 'launched',
      status: 'async_launched',
      agentId: 'agent-1',
    })
    expect(drain.hasOutstanding()).toBe(true)
    expect(drain.hadBackgroundWork()).toBe(true)
    expect(drain.shouldClose(true)).toBe(false)
  })

  it('holds the stream after run.completed until an image trail settles', () => {
    let now = 0
    const drain = new BackgroundDrainTracker({
      imageTrailWaitMs: 40,
      imageTrailSettleMs: 10,
      now: () => now,
    })
    drain.observe({
      type: 'tool.started',
      id: 'img-1',
      name: 'image_gen',
      messageId: 'm',
      blockId: 'img-1',
      index: 0,
    })
    expect(drain.shouldClose(true)).toBe(false)
    expect(drain.remainingWaitMs(true)).toBe(40)
    drain.observe({
      type: 'assistant.image_delta',
      messageId: 'm',
      blockId: 'img',
      index: 1,
      b64: 'abc',
      final: true,
    })
    expect(drain.remainingWaitMs(true)).toBe(10)
    now = 10
    expect(drain.shouldClose(true)).toBe(true)
  })

  it('closes after settle once background work is gone', () => {
    let now = 0
    const drain = new BackgroundDrainTracker({ idleMs: 1_000, settleMs: 15, now: () => now })
    drain.observe({ type: 'workflow.started', workflowToolUseId: 'wf-1' })
    drain.observe({ type: 'workflow.completed', workflowToolUseId: 'wf-1', status: 'completed' })
    expect(drain.hasOutstanding()).toBe(false)
    expect(drain.shouldClose(true)).toBe(false)
    now = 15
    expect(drain.shouldClose(true)).toBe(true)
  })
})
