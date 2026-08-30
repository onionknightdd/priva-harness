import type { AgentEvent } from '../event/agent-event.js'
import { applyStreamFrame, emptyAssistantMessage } from './apply-stream-frame.js'
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
  type ThreadMessage,
  type ThreadReplayItem,
} from './thread.js'

const PASS_THROUGH_TYPES = new Set<AgentEvent['type']>([
  'run.started',
  'run.completed',
  'run.usage',
  'suggestion.prompts',
  'permission.requested',
  'permission.resolved',
  'ext',
])

export function foldThread(items: readonly ThreadReplayItem[]): ThreadMessage[] {
  const messages: ThreadMessage[] = []
  const pendingSummaries: string[] = []
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
    if (threadHasVisibleContent(completed)) messages.push(completed)
    current = undefined
    lastAtMs = undefined
  }

  for (const item of items) {
    if (item.kind === 'user') {
      finishAssistant()
      if (item.content.trim() === '') continue
      if (isHiddenCompactUserContent(item.content)) {
        if (isCompactContinuationContent(item.content)) {
          pendingSummaries.push(compactSummaryBody(item.content))
        }
        continue
      }
      const compact = compactForUser(item.content, pendingSummaries)
      messages.push({
        id: item.id,
        role: 'user',
        content: item.content,
        createdAt: item.createdAt,
        status: 'complete',
        transcriptUuid: item.id,
        ...(compact === undefined ? {} : { compact }),
      })
      continue
    }

    if (item.event.type === 'session.compacting') {
      finishAssistant()
      patchLastCompactUser(messages, { phase: 'compacting' })
      continue
    }
    if (item.event.type === 'session.compacted') {
      finishAssistant()
      const summary = item.event.summary ?? pendingSummaries.shift()
      patchLastCompactUser(
        messages,
        summary === undefined
          ? { phase: 'compacted' }
          : { phase: 'compacted', summary },
      )
      continue
    }

    if (PASS_THROUGH_TYPES.has(item.event.type)) continue

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
    if (item.event.type === 'error' || item.event.type === 'run.failed') {
      failLastCompactUser(messages)
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
  if (message.nestedAgents?.some((agent) => agent.parentToolUseId === parentId) === true) {
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

function compactForUser(
  content: string,
  pendingSummaries: string[],
): CompactMarker | undefined {
  if (!isCompactCommandContent(content)) return undefined
  const summary = pendingSummaries.shift()
  if (summary === undefined) return { phase: 'compacting' }
  return { phase: 'compacted', summary }
}

function patchLastCompactUser(
  messages: ThreadMessage[],
  patch: CompactMarker,
): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    if (message.compact === undefined && !isCompactCommandContent(message.content)) {
      continue
    }
    messages[index] = {
      ...message,
      compact: mergeCompactMarker(message.compact, patch),
    }
    return
  }
}

function failLastCompactUser(messages: ThreadMessage[]): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    if (message.compact?.phase === 'compacted') return
    if (message.compact !== undefined || isCompactCommandContent(message.content)) {
      messages[index] = { ...message, compact: { phase: 'failed' } }
    }
    return
  }
}

function atMsOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}
