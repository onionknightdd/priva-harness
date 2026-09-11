import { describe, expect, it } from 'vitest'
import { piWorkflowState } from '../../../../src/provider/pi/pi-workflow-data.js'
import { PiEventMapper } from '../../../../src/provider/pi/pi-event-mapper.js'
import { replayPiSessionMessages } from '../../../../src/provider/pi/pi-thread-replay.js'

describe('Pi workflow normalization', () => {
  const snapshot = { runId: 'run:one', name: 'Review', description: 'Two stages', phases: ['Read', 'Check'], agents: [
    { id: 1, callId: 'run:one:0', label: 'Same title', phase: 'Read', status: 'done', startedAt: 1000, endedAt: 2500, tokenUsage: { input: 10, output: 5, cacheRead: 20, total: 35 }, result: 'OK' },
    { id: 2, callId: 'run:one:1', label: 'Same title', phase: 'Check', status: 'skipped' },
  ] }

  it('maps stable call IDs, phases, real usage, timing and skipped state', () => {
    const state = piWorkflowState('tool', { ...snapshot, status: 'completed' })
    expect(state).toMatchObject({ workflowToolUseId: 'tool', workflowRunId: 'run:one', summary: 'Two stages', status: 'completed' })
    expect(state.agents[0]).toMatchObject({ index: 1, agentId: 'run:one:0', phaseIndex: 1, tokens: 35, durationMs: 1500, resultPreview: 'OK' })
    expect(state.agents[1]).toMatchObject({ agentId: 'run:one:1', phaseIndex: 2, state: 'skipped' })
  })

  it('does not report success or estimated scalar tokens for a failed subagent', () => {
    const state = piWorkflowState('tool', { ...snapshot, status: 'completed', agents: [{ id: 1, status: 'error', tokens: 51, tokenUsage: { input: 0, output: 0, total: 51 } }] })
    expect(state.status).toBe('failed')
    expect(state.agents[0]?.tokens).toBeUndefined()
  })

  it('keeps cancellation and paused states', () => {
    expect(piWorkflowState('tool', { ...snapshot, status: 'aborted' }).status).toBe('cancelled')
    expect(piWorkflowState('tool', { ...snapshot, status: 'paused' }).status).toBe('paused')
  })

  it('maps structured foreground tool details and retains richer bridge state', () => {
    const mapper = new PiEventMapper({ sessionId: 'session', model: 'm' })
    mapper.push({ type: 'tool_execution_start', toolCallId: 'tool', toolName: 'workflow', args: {} })
    const events = mapper.push({ type: 'tool_execution_update', toolCallId: 'tool', partialResult: { content: [{ type: 'text', text: 'progress' }], details: snapshot } })
    expect(events[0]).toMatchObject({ type: 'workflow.progress', workflow: { agents: [{ agentId: 'run:one:0' }, { agentId: 'run:one:1' }] } })
    const workflow = piWorkflowState('tool', { ...snapshot, status: 'failed' })
    mapper.push({ type: 'workflow_progress', workflow })
    const completed = mapper.push({ type: 'tool_execution_end', toolCallId: 'tool', toolName: 'workflow', result: { details: { runId: 'run:one', background: true } } })
    expect(completed.some((event) => event.type === 'workflow.progress')).toBe(false)
  })

  it('restores the latest durable snapshot when replaying a background launch', () => {
    const workflowState = piWorkflowState('old-tool', { ...snapshot, status: 'completed' })
    const replay = replayPiSessionMessages([{ type: 'tool_result', uuid: 'result', sessionId: 'session', parentToolUseId: 'tool', timestamp: 10, metadata: null,
      message: { role: 'toolResult', toolName: 'workflow', details: { runId: 'run:one', background: true, workflowState } } }])
    expect(replay).toContainEqual(expect.objectContaining({ kind: 'frame', event: expect.objectContaining({ type: 'workflow.progress', workflow: expect.objectContaining({ workflowToolUseId: 'tool', status: 'completed' }) as unknown }) as unknown }))
    expect(replay[0]).toMatchObject({ kind: 'frame', event: { type: 'task.updated', task: { toolUseId: 'tool', status: 'completed' } } })
  })
})
