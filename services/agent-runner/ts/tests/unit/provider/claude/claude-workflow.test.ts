import { applyStreamFrame, emptyAssistantMessage } from '../../../../src/core/resource/apply-stream-frame.js'
import { describe, expect, it } from 'vitest'
import { ClaudeWorkflows } from '../../../../src/provider/claude/claude-workflow.js'
import { ClaudeEventMapper, type ClaudeSdkMessage } from '../../../../src/provider/claude/claude-event-mapper.js'
import { workflowLaunch, workflowSnapshot } from '../../../fixtures/claude-workflow.js'

describe('dynamic workflow aggregation', () => {
  it('groups a 2×2 snapshot and keeps rejected business results successful', () => {
    const state = new ClaudeWorkflows().update('tool-one', workflowSnapshot)
    expect(state.phases.map((phase) => phase.title)).toEqual(['Generate', 'Verify'])
    expect(state.agents.map((agent) => agent.phaseIndex)).toEqual([1, 1, 2, 2])
    expect(state.agents[2]).toMatchObject({ state: 'completed', resultPreview: '{"accepted":false}' })
    expect(state).toMatchObject({ workflowRunId: 'wf_test', durationMs: 14000, status: 'completed' })
  })

  it('merges task-only patches and dynamically appended agents without duplicating steps', () => {
    const states = new ClaudeWorkflows()
    const first = states.update('tool-one', { ...workflowLaunch, workflowProgress: [
      { type: 'workflow_agent', index: 1, label: 'First', state: 'running', phaseIndex: 1, phaseTitle: 'Generate' },
    ] })
    const update = { task_id: 'task-one', patch: { workflowProgress: [
      { type: 'workflow_agent', index: 1, state: 'done', durationMs: 1000 },
      { type: 'workflow_agent', index: 2, label: 'Second', state: 'queued', phaseIndex: 2, phaseTitle: 'Verify' },
    ] } }
    expect(states.toolForTask('task-one')).toBe('tool-one')
    const second = states.update('tool-one', update)
    expect(second.agents).toHaveLength(2)
    expect(second.agents[0]).toMatchObject({ label: 'First', state: 'completed', durationMs: 1000 })
    expect(second.phases.map((phase) => phase.title)).toEqual(['Generate', 'Verify'])
    expect(states.update('tool-one', update)).toEqual(second)
    expect(first.agents[0]?.state).toBe('running')
    expect(states.update('tool-one', { patch: { status: 'killed' } }).status).toBe('cancelled')
  })

  it('adopts early task-only progress when the tool launch arrives and settles cancelled agents', () => {
    const mapper = new ClaudeEventMapper()
    mapper.push({ type: 'assistant', message: { id: 'a1', content: [{ type: 'tool_use', id: 'tool-one', name: 'Workflow', input: {} }] } })
    const early = mapper.push({ type: 'system', subtype: 'task_started', workflow_name: 'test', task_id: 'task-one',
      workflow_progress: [{ type: 'workflow_agent', index: 1, label: 'First', state: 'running' }],
    } as ClaudeSdkMessage)
    expect(early.some((event) => event.type === 'workflow.started')).toBe(false)
    const launch = mapper.push({ type: 'user', tool_use_result: workflowLaunch,
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-one', content: 'Launched' }] } })
    const state = launch.find((event) => event.type === 'workflow.progress')
    expect(state?.workflow?.agents).toHaveLength(1)
    const cancelled = mapper.push({ type: 'system', subtype: 'task_updated', task_id: 'task-one', patch: { status: 'killed' } } as ClaudeSdkMessage)
    const final = cancelled.find((event) => event.type === 'workflow.progress')
    expect(final?.workflow).toMatchObject({ workflowToolUseId: 'tool-one', status: 'cancelled', agents: [{ state: 'cancelled' }] })
  })

  it('settles unfinished workflows when the parent run is aborted', () => {
    const workflow = new ClaudeWorkflows().update('tool-one', {
      ...workflowLaunch, workflowProgress: [
        { type: 'workflow_agent', index: 1, label: 'Finished', state: 'done' },
        { type: 'workflow_agent', index: 2, label: 'Working', state: 'running' },
      ],
    })
    const message = { ...emptyAssistantMessage('a1', '2026-09-05T10:00:00Z'), workflows: [workflow] }
    const aborted = applyStreamFrame(message, { type: 'run.aborted' })
    expect(aborted.workflows?.[0]).toMatchObject({ status: 'cancelled', agents: [{ state: 'completed' }, { state: 'cancelled' }] })
    const background = applyStreamFrame({ ...message, blocks: [{ type: 'tool_use', name: 'workflow', id: 'tool-one', blockId: 'tool-one', index: 0,
      tool: { id: 'tool-one', name: 'workflow', status: 'completed', backgroundTask: { taskId: 'bg', toolUseId: 'tool-one', kind: 'workflow', status: 'running' } } }] }, { type: 'run.aborted' })
    expect(background.workflows?.[0]?.status).toBe(workflow.status)
  })

  it('routes a task update lacking workflow markers using the launch identity', () => {
    const mapper = new ClaudeEventMapper()
    mapper.push({ type: 'assistant', message: { id: 'a1', content: [{ type: 'tool_use', id: 'tool-one', name: 'Workflow', input: {} }] } })
    const launch = mapper.push({ type: 'user', tool_use_result: workflowLaunch,
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-one', content: 'Workflow launched in background.' }] } })
    expect(launch).toContainEqual(expect.objectContaining({ type: 'workflow.progress',
      workflow: expect.objectContaining({ status: 'running', workflowRunId: 'wf_test' }) as unknown }))
    expect(launch.some((event) => event.type === 'workflow.completed')).toBe(false)
    const update = mapper.push({ type: 'system', subtype: 'task_updated', task_id: 'task-one',
      patch: { status: 'failed', workflowProgress: [{ type: 'workflow_agent', index: 1, label: 'Test', state: 'error', error: 'Timed out' }] },
    } as ClaudeSdkMessage)
    expect(update).toContainEqual(expect.objectContaining({ type: 'workflow.progress', workflowToolUseId: 'tool-one',
      workflow: expect.objectContaining({ status: 'failed', agents: [expect.objectContaining({ state: 'failed', error: 'Timed out' })] }) as unknown }))
    expect(update).toContainEqual({ type: 'workflow.completed', workflowToolUseId: 'tool-one', status: 'failed' })
    expect(update.some((event) => event.type.startsWith('agent.'))).toBe(false)
  })
})
