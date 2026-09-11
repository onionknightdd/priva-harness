import { asRecord, stringField } from '../../core/event/json-record.js'
import { taskStatus, type BackgroundTask } from '../../core/resource/background-task.js'
import { piWorkflowToolResult } from './pi-workflow-data.js'

export function piBackgroundLaunch(toolUseId: string, name: string, result: unknown): BackgroundTask | undefined {
  const details = asRecord(asRecord(result)?.['details']) ?? {}
  const workflow = piWorkflowToolResult(toolUseId, name, result, undefined, true)
  if (details['background'] === true && workflow?.workflowRunId) return {
    taskId: workflow.workflowRunId, toolUseId, kind: 'workflow', status: taskStatus(workflow.status),
    ...(workflow.name ? { description: workflow.name } : {}),
  }
  const taskId = stringField(details, 'agentId')
  if (!taskId || details['status'] !== 'background') return undefined
  return {
    taskId, toolUseId, kind: 'agent', status: 'running',
    ...(typeof details['outputFile'] === 'string' ? { outputFile: details['outputFile'] } : {}),
    ...(typeof details['description'] === 'string' ? { description: details['description'] } : {}),
  }
}

/** Custom message metadata is native provenance; user-authored XML is never a notification. */
export function piTaskNotices(message: unknown): BackgroundTask[] {
  const raw = asRecord(message)
  if (raw?.['role'] !== 'custom') return []
  const details = asRecord(raw['details']) ?? {}
  if (raw['customType'] === 'workflow-notification' && typeof details['workflowRunId'] === 'string') return [{
    taskId: details['workflowRunId'], kind: 'workflow', status: taskStatus(details['status']),
    ...(typeof details['workflowToolUseId'] === 'string' ? { toolUseId: details['workflowToolUseId'] } : {}),
    ...(typeof details['name'] === 'string' ? { description: details['name'] } : {}),
    ...(typeof details['summary'] === 'string' ? { summary: details['summary'] } : {}),
    ...(typeof details['result'] === 'string' ? { result: details['result'] } : {}),
  }]
  if (raw['customType'] !== 'subagent-notification') return []
  const others: unknown[] = Array.isArray(details['others']) ? details['others'] : []
  return [details, ...others].flatMap((value) => {
    const item = asRecord(value) ?? {}
    const taskId = stringField(item, 'id')
    return taskId ? [{
      taskId, kind: 'agent' as const, status: taskStatus(item['status']),
      ...(typeof item['description'] === 'string' ? { description: item['description'] } : {}),
      ...(typeof item['outputFile'] === 'string' ? { outputFile: item['outputFile'] } : {}),
      ...(typeof item['error'] === 'string' ? { summary: item['error'] } : {}),
      ...(typeof item['resultPreview'] === 'string' ? { result: item['resultPreview'] } : {}),
    }] : []
  })
}
