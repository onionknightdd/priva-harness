import { ClaudeEventMapper, type ClaudeSdkMessage } from '../claude-event-mapper.js'
import { asRecord, isRecord, stringField } from '../../../core/event/json-record.js'
import type { SessionMessage } from '../../../core/resource/session.js'
import type { ThreadReplayItem } from '../../../core/resource/thread.js'

export function replayClaudeSessionMessages(
  messages: readonly SessionMessage[],
): ThreadReplayItem[] {
  const mapper = new ClaudeEventMapper()
  const items: ThreadReplayItem[] = []

  for (const message of messages) {
    if (isVisibleUserTurn(message)) {
      const content = userContent(message.message)
      if (content.trim() === '') continue
      items.push({
        kind: 'user',
        id: message.uuid === '' ? `user-${String(items.length)}` : message.uuid,
        content,
        createdAt: isoFromTimestamp(message.timestamp),
      })
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
