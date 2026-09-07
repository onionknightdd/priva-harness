import { isWorkflowName } from '../../../core/event/tool-names.js'
import { ClaudeEventMapper, type ClaudeSdkMessage } from '../claude-event-mapper.js'
import { asRecord, isRecord, stringField } from '../../../core/event/json-record.js'
import type { SessionMessage } from '../../../core/resource/session.js'
import type { ThreadReplayItem } from '../../../core/resource/thread.js'
import { isSyntheticNoResponseAssistant } from './claude-transcript.js'

export function replayClaudeSessionMessages(
  messages: readonly SessionMessage[],
): ThreadReplayItem[] {
  const mapper = new ClaudeEventMapper()
  const items: ThreadReplayItem[] = []
  const workflowIds = new Set<string>()

  for (const message of messages) {
    rememberWorkflowIds(message.message, workflowIds)
    const notification = workflowNotification(message, workflowIds)
    if (notification !== undefined) {
      for (const event of mapper.push(notification)) {
        items.push({ kind: 'frame', event, createdAt: isoFromTimestamp(message.timestamp) })
      }
      continue
    }
    if (isVisibleUserTurn(message)) {
      const content = userContent(message.message)
      if (content.trim() === '' || content.trimStart().startsWith('[structured-output-enforce]')) continue
      items.push({
        kind: 'user',
        id: message.uuid === '' ? `user-${String(items.length)}` : message.uuid,
        content,
        createdAt: isoFromTimestamp(message.timestamp),
      })
      continue
    }

    if (
      isSyntheticNoResponseAssistant({
        type: message.type,
        message: message.message,
      })
    ) {
      continue
    }

    const sdk = toClaudeSdkMessage(message)
    if (sdk === undefined) continue
    const createdAt = isoFromTimestamp(message.timestamp)
    for (const event of mapper.push(sdk)) {
      items.push({ kind: 'frame', event, createdAt })
    }
  }

  return items
}

function isVisibleUserTurn(message: SessionMessage): boolean {
  if (message.type !== 'user') return false
  if (stringField(asRecord(message.message) ?? {}, 'sourceToolUseID') !== undefined) return false
  if (message.parentToolUseId !== null && message.parentToolUseId !== '') return false
  return !hasToolResult(message.message)
}

function hasToolResult(raw: unknown): boolean {
  const record = asRecord(raw)
  if (record === undefined) return false
  const content = record['content']
  if (!Array.isArray(content)) return false
  return content.some((part) => isRecord(part) && stringField(part, 'type') === 'tool_result')
}

function userContent(raw: unknown): string {
  if (typeof raw === 'string') return raw
  const record = asRecord(raw)
  if (record === undefined) return ''
  const content = record['content']
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(isRecord)
    .map((block) => stringField(block, 'text') ?? '')
    .join('')
}

function toClaudeSdkMessage(message: SessionMessage): ClaudeSdkMessage | undefined {
  if (
    message.type === 'compaction' ||
    message.type === 'custom' ||
    message.type === 'branch_summary' ||
    message.type === 'bash_execution'
  ) {
    return undefined
  }

  if (message.type === 'stream_event') {
    const inner = asRecord(message.message) ?? {}
    return {
      type: 'stream_event',
      session_id: message.sessionId,
      event: inner['event'] ?? inner,
      ...(message.parentToolUseId === null || message.parentToolUseId === ''
        ? {}
        : { parent_tool_use_id: message.parentToolUseId }),
    }
  }

  if (message.type === 'system') {
    const raw = asRecord(message.message) ?? {}
    return {
      ...raw,
      type: 'system',
      session_id: message.sessionId,
    }
  }

  const type = message.type === 'tool_result' ? 'user' : message.type
  const payload = withAssistantId(normalizePayload(message), message.uuid)
  const inner = asRecord(payload)
  const toolUseResult = inner?.['tool_use_result'] ?? inner?.['toolUseResult']
  return {
    type,
    session_id: message.sessionId,
    ...(message.parentToolUseId === null || message.parentToolUseId === ''
      ? {}
      : { parent_tool_use_id: message.parentToolUseId }),
    message: payload,
    uuid: message.uuid,
    ...(toolUseResult === undefined ? {} : { tool_use_result: toolUseResult }),
  }
}

function normalizePayload(message: SessionMessage): unknown {
  if (message.type !== 'tool_result') return message.message
  const record = asRecord(message.message) ?? {}
  if (hasToolResult(record)) return record
  const id =
    message.parentToolUseId ??
    stringField(record, 'toolCallId') ??
    stringField(record, 'tool_use_id') ??
    message.uuid
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: id,
        content: record['content'] ?? record['output'] ?? '',
        is_error: record['isError'] === true || record['is_error'] === true,
      },
    ],
  }
}

function withAssistantId(raw: unknown, uuid: string): unknown {
  const record = asRecord(raw)
  if (record === undefined) {
    return uuid === '' ? raw : { id: uuid }
  }
  if (stringField(record, 'id') !== undefined || uuid === '') return record
  return { ...record, id: uuid }
}

function isoFromTimestamp(value: number | null): string {
  if (value === null || value <= 0) return new Date(0).toISOString()
  return new Date(value).toISOString()
}

function workflowNotification(message: SessionMessage, workflowIds: ReadonlySet<string>): ClaudeSdkMessage | undefined {
  if (message.type !== 'user') return undefined
  const text = userContent(message.message).trim()
  if (!text.startsWith('<task-notification>')) return undefined
  const field = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'u').exec(text)?.[1]
  const toolId = field('tool-use-id')
  if (toolId === undefined || !workflowIds.has(toolId)) return undefined
  return {
    type: 'system', subtype: 'task_notification',
    task_type: 'workflow', task_id: field('task-id'), tool_use_id: field('tool-use-id'),
    status: field('status'), summary: field('summary'),
  } as ClaudeSdkMessage
}

function rememberWorkflowIds(raw: unknown, ids: Set<string>): void {
  const content = asRecord(raw)?.['content']
  if (!Array.isArray(content)) return
  for (const block of content) {
    const item = asRecord(block)
    if (item?.['type'] !== 'tool_use' || !isWorkflowName(stringField(item, 'name') ?? '')) continue
    const id = stringField(item, 'id')
    if (id !== undefined) ids.add(id)
  }
}
