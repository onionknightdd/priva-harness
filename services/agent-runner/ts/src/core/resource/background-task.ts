export type BackgroundTaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface BackgroundTask {
  readonly taskId: string
  readonly kind: 'bash' | 'agent' | 'workflow' | 'monitor' | 'other'
  readonly status: BackgroundTaskStatus
  readonly toolUseId?: string
  readonly originRunId?: string
  readonly description?: string
  readonly summary?: string
  readonly outputFile?: string
  readonly result?: string | null
  readonly tokens?: number
  readonly durationMs?: number
  readonly updatedAt?: number
  readonly stopRequested?: boolean
}

export interface TaskNotification {
  readonly id: string
  readonly task: BackgroundTask
  readonly createdAt?: string
  /** A batch consumed during another reply owns an independent rendered turn. */
  readonly turnId?: string
}

export interface TaskReplyTarget {
  readonly notificationIds: readonly string[]
  readonly taskId: string
  readonly toolUseId?: string
  readonly turnId?: string
}

export function taskNotificationReplyTarget(notification: TaskNotification): TaskReplyTarget {
  return { notificationIds: [notification.id], taskId: notification.task.taskId,
    ...(notification.task.toolUseId ? { toolUseId: notification.task.toolUseId } : {}),
    ...(notification.turnId ? { turnId: notification.turnId } : {}) }
}

export function taskIsActive(task: BackgroundTask): boolean {
  return !['completed', 'failed', 'cancelled'].includes(task.status)
}

export function taskStatus(value: unknown): BackgroundTaskStatus {
  if (value === 'stopped' || value === 'killed' || value === 'cancelled' || value === 'aborted') return 'cancelled'
  if (value === 'error') return 'failed'
  if (value === 'completed' || value === 'failed' || value === 'paused' || value === 'pending' || value === 'running') return value
  return 'unknown'
}

export function taskKind(value: string): BackgroundTask['kind'] {
  const name = value.toLowerCase()
  if (name.includes('workflow')) return 'workflow'
  if (name.includes('monitor')) return 'monitor'
  if (name.includes('bash') || name.includes('shell')) return 'bash'
  if (name.includes('agent') || name === 'task') return 'agent'
  return 'other'
}

/** A missing membership entry is not a terminal event: SDK snapshots and notices can cross. */
export class BackgroundTasks {
  private readonly tasks = new Map<string, BackgroundTask>()

  update(patch: BackgroundTask): BackgroundTask {
    const previous = this.tasks.get(patch.taskId)
    const next = {
      ...previous,
      ...patch,
      kind: patch.kind === 'other' ? previous?.kind ?? patch.kind : patch.kind,
      status: previous && !taskIsActive(previous) && taskIsActive(patch) ? previous.status : patch.status,
    }
    this.tasks.set(next.taskId, next)
    return next
  }

  snapshot(active: readonly BackgroundTask[]): readonly BackgroundTask[] {
    const ids = new Set(active.map((task) => task.taskId))
    for (const [id, task] of this.tasks) {
      if (taskIsActive(task) && !ids.has(id)) this.tasks.set(id, { ...task, status: 'unknown' })
    }
    for (const task of active) this.update(task)
    return this.list()
  }

  list(): readonly BackgroundTask[] { return [...this.tasks.values()] }
  get(id: string): BackgroundTask | undefined { return this.tasks.get(id) }
  get hasActive(): boolean { return this.list().some(taskIsActive) }
}

/** Only provider-originated notices are eligible. A person's XML remains ordinary text. */
export function taskNotification(origin: unknown, content: string): Record<string, string> | undefined {
  if (typeof origin !== 'object' || origin === null || !('kind' in origin) || origin.kind !== 'task-notification') return undefined
  const text = content.trim()
  if (!text.startsWith('<task-notification>') || !text.endsWith('</task-notification>')) return undefined
  const fields: Record<string, string> = {}
  for (const name of ['task-id', 'tool-use-id', 'status', 'summary', 'output-file', 'result', 'subagent_tokens', 'duration_ms']) {
    const value = new RegExp(`<${name}>([\\s\\S]*${name === 'result' ? '' : '?'})</${name}>`, 'u').exec(text)?.[1]
    if (value !== undefined) fields[name.replaceAll('-', '_')] = value
  }
  if (!fields['task_id'] || taskStatus(fields['status']) === 'unknown') return undefined
  return fields
}
