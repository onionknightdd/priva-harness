import { userTurnFromText } from '../run/user-turn.js'
import type { AgentEvent } from '../event/agent-event.js'
import { applyStreamFrame, emptyAssistantMessage } from './apply-stream-frame.js'
import { taskNotificationReplyTarget } from './background-task.js'
import {
  compactSummaryBody,
  isCompactCommandContent,
  isCompactContinuationContent,
  isHiddenCompactUserContent,
  mergeCompactMarker,
  type CompactMarker,
} from './compact-command.js'
import { freezeMessageThinking, stampMessageThinkingTimes } from './thinking-time.js'
import {
  threadHasVisibleContent,
  taskReplyOwner,
  type ThreadMessage,
  type ThreadReplayItem,
} from './thread.js'

const PASS_THROUGH_TYPES = new Set<AgentEvent['type']>([
  'run.started',
  'run.completed',
  'run.usage',
  'suggestion.prompts',
  'permission.requested',
  'ext',
])

export function foldThread(items: readonly ThreadReplayItem[]): ThreadMessage[] {
  const messages: ThreadMessage[] = []
  // Claude can persist a summary before its command. Associate only the current
  // compaction segment; an ordinary visible turn ends that association.
  let compactIndex: number | undefined
  let compactHasCommand = false
  let current: ThreadMessage | undefined
  let lastAtMs: number | undefined

  const finishAssistant = () => {
    if (current === undefined) return
    const frozen = freezeMessageThinking(
      current,
      lastAtMs ?? Date.parse(current.createdAt),
    )
    const completed: ThreadMessage = {
      ...frozen,
      status: frozen.status === 'error' ? 'error' : 'complete',
    }
    if (threadHasVisibleContent(completed)) {
      messages.push(completed)
      compactIndex = undefined
    }
    current = undefined
    lastAtMs = undefined
  }

  const updateCompact = (patch: CompactMarker, createdAt = createdAtNow(), sourceId?: string) => {
    finishAssistant()
    const index = compactIndex
    const previous = index === undefined ? undefined : messages[index]
    if (previous && index !== undefined) {
      messages[index] = { ...previous, compact: mergeCompactMarker(previous.compact, patch) }
      return
    }
    compactIndex = messages.length
    compactHasCommand = false
    messages.push({ id: `compact:${sourceId ?? createdAt}:${String(compactIndex)}`, role: 'user', content: '/compact',
      createdAt, status: 'complete', compact: patch })
  }

  for (const item of items) {
    if (item.kind === 'user') {
      finishAssistant()
      const parsed = userTurnFromText(item.content)
      const turn = { ...parsed, ...(item.attachments?.length ? { attachments: [...parsed.attachments ?? [], ...item.attachments] } : {}) }
      if (turn.text.trim() === '' && !turn.attachments?.length) continue
      if (!turn.attachments?.length && isHiddenCompactUserContent(turn.text)) {
        if (isCompactContinuationContent(turn.text)) {
          updateCompact({ phase: 'compacted', summary: compactSummaryBody(turn.text) }, item.createdAt, item.id)
        }
        continue
      }
      const isCompact = !turn.attachments?.length && isCompactCommandContent(turn.text)
      const candidate = isCompact && !compactHasCommand && compactIndex !== undefined ? messages[compactIndex] : undefined
      const previous = candidate?.compact?.phase === 'failed' || candidate?.compact?.phase === 'cancelled' ? undefined : candidate
      const message: ThreadMessage = {
        id: item.id,
        role: 'user',
        content: turn.text,
        ...(turn.attachments === undefined ? {} : { attachments: turn.attachments }),
        createdAt: item.createdAt,
        status: 'complete',
        transcriptUuid: item.id,
        ...(isCompact ? { compact: previous?.compact ?? { phase: 'queued' } } : {}),
        ...(item.modelChange === undefined ? {} : { modelChange: item.modelChange }),
        ...(item.effortChange === undefined ? {} : { effortChange: item.effortChange }),
      }
      if (previous && compactIndex !== undefined) messages[compactIndex] = message
      else {
        compactIndex = isCompact ? messages.length : undefined
        messages.push(message)
      }
      compactHasCommand = isCompact
      continue
    }

    if (item.event.type === 'tasks.snapshot' || item.event.type === 'session.state' || item.event.type === 'session.snapshot') continue

    if (item.event.type === 'session.compacting') {
      finishAssistant()
      const phase = compactIndex === undefined ? undefined : messages[compactIndex]?.compact?.phase
      if (phase !== 'queued' && phase !== 'compacting') compactIndex = undefined
      updateCompact({ phase: 'compacting' }, item.createdAt)
      continue
    }
    if (item.event.type === 'session.compacted') {
      updateCompact({ phase: 'compacted', ...(item.event.summary === undefined ? {} : { summary: item.event.summary }) }, item.createdAt)
      continue
    }
    if (item.event.type === 'session.compaction_failed' || item.event.type === 'session.compaction_cancelled') {
      updateCompact({ phase: item.event.type === 'session.compaction_failed' ? 'failed' : 'cancelled',
        ...(item.event.message === undefined ? {} : { message: item.event.message }) }, item.createdAt)
      continue
    }

    if (PASS_THROUGH_TYPES.has(item.event.type)) continue

    if (item.event.type === 'permission.resolved') {
      if (item.event.resolution.request.kind !== 'question') continue
      const toolId = item.event.resolution.request.toolUseId
      const target = toolId ? findAssistantForParent(messages, current, toolId) : current
      if (target && target !== current) {
        replaceMessage(messages, applyStreamFrame(target, item.event))
      } else {
        current ??= emptyAssistantMessage(assistantIdOf(item.event), item.createdAt ?? createdAtNow())
        current = applyStreamFrame(current, item.event)
      }
      continue
    }

    if (item.event.type === 'task.delivered') {
      const update: AgentEvent = { type: 'task.updated', task: item.event.task }
      for (const [index, message] of messages.entries()) messages[index] = applyStreamFrame(message, update)
      if (current) current = applyStreamFrame(current, update)
      const turnId = item.event.notification.turnId
      if (!turnId || current?.id !== turnId) finishAssistant()
      if (turnId) current ??= emptyAssistantMessage(turnId, item.createdAt ?? createdAtNow())
    }

    const reply = item.event.type === 'task.delivered'
      ? taskNotificationReplyTarget(item.event.notification)
      : item.event.replyTo
    const replyOwner = reply ? taskReplyOwner([...messages, ...(current ? [current] : [])], reply) : undefined
    if (replyOwner) {
      const atMs = atMsOf(item.createdAt)
      const updated = applyStreamFrame(replyOwner, item.event)
      const stamped = atMs === undefined ? updated : stampMessageThinkingTimes(replyOwner, updated, item.event, atMs)
      if (current?.id === replyOwner.id) { current = stamped; if (atMs !== undefined) lastAtMs = atMs }
      else replaceMessage(messages, { ...stamped, status: stamped.status === 'error' ? 'error' : 'complete' })
      continue
    }

    const parentId = parentToolUseIdOf(item.event)
    const atMs = atMsOf(item.createdAt)
    if (atMs !== undefined) lastAtMs = atMs
    if (parentId !== undefined) {
      const target = findAssistantForParent(messages, current, parentId)
      if (target !== undefined) {
        const updated = applyStreamFrame(target, item.event)
        const stamped =
          atMs === undefined
            ? updated
            : stampMessageThinkingTimes(target, updated, item.event, atMs)
        if (current?.id === target.id) {
          current = stamped
        } else {
          replaceMessage(messages, stamped)
        }
        continue
      }
    }

    current ??= emptyAssistantMessage(
      assistantIdOf(item.event),
      item.createdAt ?? createdAtNow(),
    )
    const previous = current
    current = applyStreamFrame(current, item.event)
    if (atMs !== undefined) {
      current = stampMessageThinkingTimes(previous, current, item.event, atMs)
    }
    if (item.event.type === 'error' || item.event.type === 'run.failed' || item.event.type === 'run.aborted') {
      const index = compactIndex
      const compact = index === undefined ? undefined : messages[index]
      if (compact && index !== undefined && (compact.compact?.phase === 'queued' || compact.compact?.phase === 'compacting')) {
        messages[index] = { ...compact, compact: { phase: item.event.type === 'run.aborted' ? 'cancelled' : 'failed' } }
      }
    }
  }

  finishAssistant()
  return messages
}

function findAssistantForParent(
  messages: readonly ThreadMessage[],
  current: ThreadMessage | undefined,
  parentId: string,
): ThreadMessage | undefined {
  if (current !== undefined && assistantOwnsParent(current, parentId)) return current
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message !== undefined && assistantOwnsParent(message, parentId)) return message
  }
  return current
}

function assistantOwnsParent(message: ThreadMessage, parentId: string): boolean {
  if (message.role !== 'assistant') return false
  if (message.nestedAgents?.some((agent) => agent.parentToolUseId === parentId || agent.blocks.some((block) => block.type === 'tool_use' && block.id === parentId)) === true) {
    return true
  }
  return (message.blocks ?? []).some((block) => block.type === 'tool_use' && block.id === parentId)
}

function replaceMessage(messages: ThreadMessage[], next: ThreadMessage): void {
  const index = messages.findIndex((message) => message.id === next.id)
  if (index < 0) {
    messages.push(next)
    return
  }
  messages[index] = next
}

function parentToolUseIdOf(event: AgentEvent): string | undefined {
  if (event.type === 'task.updated' || event.type === 'task.notification' || event.type === 'task.delivered') return event.task.toolUseId
  if ('workflowToolUseId' in event) return event.workflowToolUseId
  return 'parentToolUseId' in event ? event.parentToolUseId : undefined
}

function assistantIdOf(event: AgentEvent): string {
  if ('messageId' in event && event.messageId !== '') return event.messageId
  if ('id' in event && event.id !== '') return event.id
  return crypto.randomUUID()
}

function createdAtNow(): string {
  return new Date(0).toISOString()
}

function atMsOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}
