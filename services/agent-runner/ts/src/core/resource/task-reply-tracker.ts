import { isRunResultEvent, type AgentEvent } from '../event/agent-event.js'
import { taskNotificationReplyTarget, type TaskNotification, type TaskReplyTarget } from './background-task.js'

/** A lifecycle notification is not evidence of model consumption. Only native deliveries set this context. */
export class TaskReplyTracker {
  private readonly seen = new Set<string>()
  private pending: TaskNotification[] = []
  private reply: TaskReplyTarget | undefined

  clear(): void { this.pending = []; this.reply = undefined }

  deliver(notification: TaskNotification, independentTurn = false): AgentEvent[] {
    if (this.seen.has(notification.id)) return []
    this.seen.add(notification.id)
    if (independentTurn) notification = { ...notification, turnId: this.pending.at(-1)?.turnId ?? `task-turn:${notification.id}` }
    this.pending.push(notification)
    return [{ type: 'task.delivered', notification, task: notification.task }]
  }

  route(events: readonly AgentEvent[]): AgentEvent[] {
    return events.map((event) => this.routeEvent(event))
  }

  routeEvent(event: AgentEvent): AgentEvent {
    const main = (event.type.startsWith('assistant.') || event.type.startsWith('tool.')) &&
      !('parentToolUseId' in event && event.parentToolUseId)
    const last = this.pending.at(-1)
    if (main && last) {
      this.reply = { ...taskNotificationReplyTarget(last), notificationIds: this.pending.map((item) => item.id) }
      this.pending = []
    }
    const routed = this.reply && (main || isRunResultEvent(event)) ? { ...event, replyTo: this.reply } : event
    if (isRunResultEvent(event)) this.reply = undefined
    return routed
  }
}
