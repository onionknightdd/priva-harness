import type { InteractionResolution } from './interaction.js'
import type { BackgroundTask, TaskNotification, TaskReplyTarget } from './background-task.js'
import type { UserAttachment } from '../run/user-turn.js'
import type { WorkflowState } from './workflow.js'
import type { CompactMarker } from './compact-command.js'
import type { AgentEvent, ContentBlock } from '../event/agent-event.js'

export type ThreadToolStatus = 'started' | 'running' | 'completed'

export type ThreadBlock =
  | { readonly type: 'task_notification'; readonly blockId: string; readonly index: number; readonly notification: TaskNotification }
  | {
      readonly type: 'text'
      readonly blockId: string
      readonly index: number
      readonly text: string
    }
  | {
      readonly type: 'thinking'
      readonly blockId: string
      readonly index: number
      readonly text: string
      readonly startedAt?: number
      readonly durationMs?: number
    }
  | {
      readonly type: 'image'
      readonly blockId: string
      readonly index: number
      readonly mime?: string
      readonly url?: string
      readonly b64?: string
      readonly alt?: string
    }
  | {
      readonly type: 'tool_use'
      readonly blockId: string
      readonly index: number
      readonly id: string
      readonly name: string
      readonly input?: unknown
      readonly tool?: ThreadToolCard
    }
  | {
      readonly type: 'unknown'
      readonly blockId: string
      readonly index: number
      readonly kind: string
    }

export interface ThreadToolCard {
  readonly backgroundTask?: BackgroundTask
  readonly tokens?: number
  readonly durationMs?: number
  readonly id: string
  readonly name: string
  readonly input?: unknown
  readonly status: ThreadToolStatus
  readonly ok?: boolean
  readonly output?: string
  readonly launchStatus?: string
  readonly agentId?: string
  readonly inputRaw?: string
}

export interface ThreadInboxMessage {
  readonly deliveryId?: string
  readonly afterBlockCount?: number
  readonly body: string
  readonly source: 'peer' | 'coordinator'
  readonly senderName?: string
}

export interface ThreadNestedAgent {
  readonly parentToolUseId: string
  readonly agentId?: string
  readonly name?: string
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled'
  readonly blocks: readonly ThreadBlock[]
  readonly inbox: readonly ThreadInboxMessage[]
}

export type ThreadWorkflowCard = WorkflowState

export interface ThreadMessage {
  readonly interactions?: readonly InteractionResolution[]
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly attachments?: readonly UserAttachment[]
  readonly createdAt: string
  readonly status: 'streaming' | 'complete' | 'error'
  readonly transcriptUuid?: string
  readonly blocks?: readonly ThreadBlock[]
  readonly nestedAgents?: readonly ThreadNestedAgent[]
  readonly workflows?: readonly ThreadWorkflowCard[]
  readonly compact?: CompactMarker
}

export type ThreadReplayItem =
  | {
      readonly kind: 'user'
      readonly id: string
      readonly content: string
      readonly createdAt: string
    }
  | {
      readonly kind: 'frame'
      readonly event: AgentEvent
      readonly createdAt?: string
    }

export function threadBlocksFromContent(blocks: readonly ContentBlock[]): ThreadBlock[] {
  return blocks.map((block) => {
    if (block.type === 'unknown') {
      return {
        type: 'unknown',
        blockId: block.blockId,
        index: block.index,
        kind: block.kind,
      }
    }
    return block
  })
}

const NO_RESPONSE_REQUESTED = 'No response requested.'

function isVisibleAnswerText(text: string): boolean {
  const trimmed = text.trim()
  return trimmed !== '' && trimmed !== NO_RESPONSE_REQUESTED
}

export function answerTextBlock(
  blocks: readonly ThreadBlock[],
): Extract<ThreadBlock, { type: 'text' }> | undefined {
  const texts = [...blocks]
    .filter(
      (block): block is Extract<ThreadBlock, { type: 'text' }> =>
        block.type === 'text' && isVisibleAnswerText(block.text),
    )
    .sort((left, right) => left.index - right.index)
  const last = texts.at(-1)
  if (last === undefined) return undefined
  const hasLater = blocks.some(
    (block) => block.index > last.index && blockHasVisibleContent(block),
  )
  if (hasLater) return undefined
  return last
}

function blockHasVisibleContent(block: ThreadBlock): boolean {
  if (block.type === 'task_notification') return true
  if (block.type === 'thinking') return block.text.trim() !== ''
  if (block.type === 'text') return isVisibleAnswerText(block.text)
  return block.type === 'tool_use' || block.type === 'image'
}

export function textFromThreadBlocks(blocks: readonly ThreadBlock[]): string {
  return answerTextBlock(blocks)?.text ?? ''
}

export function threadHasVisibleContent(message: ThreadMessage): boolean {
  if (message.interactions?.length) return true
  if (message.role === 'user') return message.content.trim() !== '' || Boolean(message.attachments?.length)
  if (message.content.trim() !== '' && message.content.trim() !== NO_RESPONSE_REQUESTED) {
    return true
  }
  if ((message.workflows?.length ?? 0) > 0) return true
  if ((message.nestedAgents?.length ?? 0) > 0) return true
  return (message.blocks ?? []).some((block) => {
    if (block.type === 'tool_use' || block.type === 'image' || block.type === 'task_notification') return true
    if (block.type === 'thinking') return block.text.trim() !== ''
    if (block.type !== 'text') return false
    const text = block.text.trim()
    return text !== '' && text !== NO_RESPONSE_REQUESTED
  })
}

export function taskReplyOwner(messages: readonly ThreadMessage[], reply: TaskReplyTarget): ThreadMessage | undefined {
  if (reply.turnId) return messages.find((message) => message.role === 'assistant' && message.id === reply.turnId)
  return messages.find((message) => message.role === 'assistant' && message.blocks?.some((block) =>
    block.type === 'tool_use' ? block.id === reply.toolUseId || block.tool?.backgroundTask?.taskId === reply.taskId :
      block.type === 'task_notification' && reply.notificationIds.includes(block.notification.id)))
}
