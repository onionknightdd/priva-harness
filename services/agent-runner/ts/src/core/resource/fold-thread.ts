import type { AgentEvent } from '../event/agent-event.js'
import { applyStreamFrame, emptyAssistantMessage } from './apply-stream-frame.js'
import {
  threadHasVisibleContent,
  type ThreadMessage,
  type ThreadReplayItem,
} from './thread.js'

const PASS_THROUGH_TYPES = new Set<AgentEvent['type']>([
  'run.started',
  'run.completed',
  'run.usage',
  'tool.input_delta',
  'suggestion.prompts',
  'permission.requested',
  'permission.resolved',
  'session.compacted',
  'ext',
])

export function foldThread(items: readonly ThreadReplayItem[]): ThreadMessage[] {
  const messages: ThreadMessage[] = []
  let current: ThreadMessage | undefined

  const finishAssistant = () => {
    if (current === undefined) return
    const completed: ThreadMessage = {
      ...current,
      status: current.status === 'error' ? 'error' : 'complete',
    }
    if (threadHasVisibleContent(completed)) messages.push(completed)
    current = undefined
  }

  for (const item of items) {
    if (item.kind === 'user') {
      finishAssistant()
      if (item.content.trim() === '') continue
      messages.push({
        id: item.id,
        role: 'user',
        content: item.content,
        createdAt: item.createdAt,
        status: 'complete',
        transcriptUuid: item.id,
      })
      continue
    }

    if (PASS_THROUGH_TYPES.has(item.event.type)) continue

    const parentId = parentToolUseIdOf(item.event)
    if (parentId !== undefined) {
      const target = findAssistantForParent(messages, current, parentId)
      if (target !== undefined) {
        const updated = applyStreamFrame(target, item.event)
        if (current?.id === target.id) {
          current = updated
        } else {
          replaceMessage(messages, updated)
        }
        continue
      }
    }

    current ??= emptyAssistantMessage(
      assistantIdOf(item.event),
      item.createdAt ?? createdAtNow(),
    )
    current = applyStreamFrame(current, item.event)
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
