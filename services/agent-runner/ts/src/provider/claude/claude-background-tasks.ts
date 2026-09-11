import type { AgentEvent } from '../../core/event/agent-event.js'
import { asRecord, stringField } from '../../core/event/json-record.js'
import { BackgroundTasks, taskKind, taskStatus, type BackgroundTask } from '../../core/resource/background-task.js'

export class ClaudeBackgroundTasks {
  readonly state = new BackgroundTasks()

  launch(toolUseId: string, name: string, result: Record<string, unknown>, output = ''): AgentEvent[] {
    const status = stringField(result, 'status')
    const id = stringField(result, 'backgroundTaskId') ??
      (status === 'async_launched' || status === 'remote_launched'
        ? stringField(result, 'taskId') ?? stringField(result, 'agentId') : undefined)
    if (!id) return []
    const task: BackgroundTask = {
      taskId: id, toolUseId, kind: taskKind(name), status: 'running',
      ...optional('description', result['description'] ?? result['summary']),
      ...optional('outputFile', result['outputFile'] ?? result['rawOutputPath'] ?? launchOutputFile(output, id)),
    }
    return [{ type: 'task.updated', task: this.state.update(task) }]
  }

  push(raw: Record<string, unknown>, tools: ReadonlyMap<string, string>): AgentEvent[] {
    const subtype = raw['subtype']
    if (subtype === 'background_tasks_changed') {
      const tasks = (Array.isArray(raw['tasks']) ? raw['tasks'] : []).flatMap((value) => {
        const item = asRecord(value)
        if (!item || item['ambient'] === true || typeof item['task_id'] !== 'string') return []
        return [{ taskId: item['task_id'], kind: taskKind(stringField(item, 'task_type') ?? ''), status: 'running' as const,
          ...optional('description', item['description']) }]
      })
      return [{ type: 'tasks.snapshot', tasks: this.state.snapshot(tasks) }]
    }
    if (typeof subtype !== 'string' || !subtype.startsWith('task_') || raw['ambient'] === true) return []
    const id = stringField(raw, 'task_id')
    if (!id) return []
    const previous = this.state.get(id)
    const patch = asRecord(raw['patch']) ?? {}
    // Foreground task bookends do not turn the tool into a background launch.
    if (subtype === 'task_started' && raw['is_backgrounded'] === false) return []
    const toolUseId = stringField(raw, 'tool_use_id') ?? previous?.toolUseId
    const name = stringField(raw, 'task_type') ?? (raw['workflow_name'] ? 'workflow' : undefined) ?? stringField(raw, 'tool_name') ?? (toolUseId ? tools.get(toolUseId) : '') ?? ''
    const status = taskStatus(patch['status'] ?? raw['status'] ?? (subtype === 'task_started' ? 'running' : previous?.status))
    const tokens = finiteNumber(raw['subagent_tokens'])
    const durationMs = finiteNumber(raw['duration_ms'])
    const task = this.state.update({
      taskId: id, kind: taskKind(name), status,
      ...(toolUseId ? { toolUseId } : {}),
      ...optional('description', patch['description'] ?? raw['description']),
      ...optional('summary', raw['summary']),
      ...optional('outputFile', raw['output_file']),
      ...optional('result', raw['result']),
      ...(tokens === undefined ? {} : { tokens }),
      ...(durationMs === undefined ? {} : { durationMs }),
    })
    return [{ type: subtype === 'task_notification' ? 'task.notification' : 'task.updated', task }]
  }
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function optional<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === 'string' && value !== '' ? { [key]: value } as Record<K, string> : {}
}

function launchOutputFile(output: string, id: string): string | undefined {
  const path = /Output is being written to: (\/[^\r\n]+?\.output)/u.exec(output)?.[1]
  return path?.endsWith(`/${id}.output`) ? path : undefined
}
