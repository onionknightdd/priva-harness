import { workflowStatus } from '../../core/resource/workflow-status.js'
import { asRecord, numberField, stringField, type JsonRecord } from '../../core/event/json-record.js'
import type { WorkflowAgent, WorkflowPhase, WorkflowState } from '../../core/resource/workflow.js'

/** One state per tool invocation; task-only updates resolve through the launch result. */
export class ClaudeWorkflows {
  private readonly states = new Map<string, WorkflowState>()
  private readonly toolsByTask = new Map<string, string>()

  toolForTask(taskId: string): string | undefined {
    return this.toolsByTask.get(taskId)
  }

  update(toolId: string, data: JsonRecord): WorkflowState {
    const patch = asRecord(data['patch'])
    const raw = { ...data, ...patch }
    const known = this.states.get(toolId)
    const taskId = stringField(raw, 'task_id') ?? stringField(raw, 'taskId') ?? known?.taskId
    const priorTool = taskId === undefined ? undefined : this.toolsByTask.get(taskId)
    const previous = known ?? (priorTool === undefined ? undefined : this.states.get(priorTool))
    if (taskId !== undefined) this.toolsByTask.set(taskId, toolId)
    if (priorTool !== undefined && priorTool !== toolId) this.states.delete(priorTool)
    const phases = new Map((previous?.phases ?? []).map((phase) => [phase.index, phase]))
    const agents = new Map((previous?.agents ?? []).map((agent) => [agent.index, agent]))
    if (Array.isArray(raw['phases'])) {
      raw['phases'].forEach((value, offset) => {
        const phase = asRecord(value)
        if (phase === undefined) return
        const index = numberField(phase, 'index') ?? offset + 1
        const title = stringField(phase, 'title')
        if (title === undefined || !Number.isInteger(index) || index < 1) return
        phases.set(index, { ...phases.get(index), index, title, ...strings(phase, ['detail']) })
      })
    }
    const progress = raw['workflowProgress'] ?? raw['workflow_progress']
    const entries = [
      ...array(progress),
      ...array(raw['agents']),
    ]
    for (const entry of entries) {
      const item = asRecord(entry)
      if (item === undefined) continue
      const index = numberField(item, 'index')
      if (index === undefined || !Number.isInteger(index) || index < 1) continue
      if (item['type'] === 'workflow_phase') {
        const title = stringField(item, 'title')
        if (title !== undefined) phases.set(index, { ...phases.get(index), index, title })
        continue
      }
      const current = agents.get(index)
      const label = stringField(item, 'label') ?? current?.label
      if (label === undefined) continue
      const phaseIndex = numberField(item, 'phaseIndex') ?? current?.phaseIndex
      const phaseTitle = stringField(item, 'phaseTitle')
      if (phaseIndex !== undefined && phaseTitle !== undefined && !phases.has(phaseIndex)) {
        phases.set(phaseIndex, { index: phaseIndex, title: phaseTitle })
      }
      const state = stringField(item, 'state')
      const agent: WorkflowAgent = {
        ...current, index, label,
        state: state === undefined ? current?.state ?? 'pending' : workflowStatus(state),
        ...strings(item, ['agentId', 'model', 'lastToolName', 'lastToolSummary', 'promptPreview', 'resultPreview', 'error']),
        ...numbers(item, ['phaseIndex', 'startedAt', 'durationMs', 'tokens', 'toolCalls', 'attempt']),
      }
      agents.set(index, agent)
    }
    const status = stringField(raw, 'status')
    const name = stringField(raw, 'workflowName') ?? stringField(raw, 'workflow_name') ?? stringField(raw, 'name')
    const runId = stringField(raw, 'runId') ?? stringField(raw, 'run_id')
    const summary = previous?.summary ?? stringField(raw, 'summary') ?? stringField(raw, 'description')
    const next: WorkflowState = {
      ...previous,
      workflowToolUseId: toolId,
      status: status === undefined ? previous?.status ?? 'running' : workflowStatus(status),
      phases: [...phases.values()].sort(byIndex),
      agents: [...agents.values()].sort(byIndex),
      ...(name === undefined ? {} : { name }),
      ...(runId === undefined ? {} : { workflowRunId: runId }),
      ...(taskId === undefined ? {} : { taskId }),
      ...(summary === undefined ? {} : { summary }),
      ...numbers(raw, ['durationMs', 'totalTokens', 'totalToolCalls']),
      ...(typeof raw['detailsUnavailable'] === 'boolean' ? { detailsUnavailable: raw['detailsUnavailable'] } : {}),
    }
    // A terminal workflow cannot leave its cards spinning indefinitely. A failed
    // workflow does not prove each unfinished agent failed: mark those unknown.
    const settled = ['completed', 'failed', 'cancelled'].includes(next.status)
      ? { ...next, agents: next.agents.map((agent): WorkflowAgent =>
          agent.state === 'running' || agent.state === 'pending'
            ? { ...agent, state: next.status === 'cancelled' ? 'cancelled' : 'unknown' }
            : agent) }
      : next
    this.states.set(toolId, settled)
    return settled
  }
}

function strings<K extends string>(raw: JsonRecord, keys: readonly K[]): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {}
  for (const key of keys) {
    const value = stringField(raw, key)
    if (value !== undefined) result[key] = value
  }
  return result
}

function numbers<K extends string>(raw: JsonRecord, keys: readonly K[]): Partial<Record<K, number>> {
  const result: Partial<Record<K, number>> = {}
  for (const key of keys) {
    const value = numberField(raw, key)
    if (value !== undefined && Number.isFinite(value) && value >= 0) result[key] = value
  }
  return result
}

function byIndex(left: WorkflowPhase | WorkflowAgent, right: WorkflowPhase | WorkflowAgent): number {
  return left.index - right.index
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value as unknown[] : []
}
