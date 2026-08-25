import { asRecord, isRecord, stringField } from '../../core/event/json-record.js'
import type { AgentEvent, ContentBlock } from '../../core/event/agent-event.js'
import type { SessionMessage } from '../../core/resource/session.js'
import type { ThreadReplayItem } from '../../core/resource/thread.js'

export function replayPiSessionMessages(messages: readonly SessionMessage[]): ThreadReplayItem[] {
  const items: ThreadReplayItem[] = []

  for (const message of messages) {
    if (message.type === 'user') {
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

    if (message.type === 'assistant') {
      const inner = asRecord(message.message) ?? {}
      const messageId = stringField(inner, 'id') ?? (message.uuid === '' ? `msg-${String(items.length)}` : message.uuid)
      const blocks = contentBlocksFrom(inner, messageId)
      const createdAt = isoFromTimestamp(message.timestamp)
      items.push({
        kind: 'frame',
        event: { type: 'assistant.message', messageId, blocks },
        createdAt,
      })
      for (const block of blocks) {
        if (block.type !== 'tool_use') continue
        items.push({
          kind: 'frame',
          event: toolStartedEvent(messageId, block),
          createdAt,
        })
      }
      continue
    }

    if (message.type === 'tool_result') {
      const inner = asRecord(message.message) ?? {}
      const id =
        message.parentToolUseId ??
        stringField(inner, 'toolCallId') ??
        stringField(inner, 'id') ??
        message.uuid
      const name = (stringField(inner, 'toolName') ?? stringField(inner, 'name') ?? 'unknown').toLowerCase()
      items.push({
        kind: 'frame',
        event: {
          type: 'tool.completed',
          id,
          name,
          ok: inner['isError'] !== true && inner['is_error'] !== true,
          output: toolOutput(inner),
          messageId: message.uuid,
          blockId: id,
        },
        createdAt: isoFromTimestamp(message.timestamp),
      })
    }
  }

  return items
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

function contentBlocksFrom(message: Record<string, unknown>, messageId: string): ContentBlock[] {
  const content = message['content']
  if (typeof content === 'string') {
    return content === ''
      ? []
      : [{ type: 'text', blockId: `${messageId}:0`, index: 0, text: content }]
  }
  if (!Array.isArray(content)) return []
  const blocks: ContentBlock[] = []
  content.forEach((item, index) => {
    const block = asRecord(item)
    if (block === undefined) return
    const type = stringField(block, 'type')
    if (type === 'text' || (type === undefined && typeof block['text'] === 'string')) {
      const text = stringField(block, 'text') ?? ''
      if (text === '') return
      blocks.push({ type: 'text', blockId: `${messageId}:${String(index)}`, index, text })
      return
    }
    if (type === 'thinking') {
      blocks.push({
        type: 'thinking',
        blockId: `${messageId}:${String(index)}`,
        index,
        text: stringField(block, 'thinking') ?? stringField(block, 'text') ?? '',
      })
      return
    }
    if (type === 'image' || type === 'image_url' || type === 'output_image') {
      blocks.push({
        type: 'image',
        blockId: `${messageId}:${String(index)}`,
        index,
        ...imageFrom(block),
      })
      return
    }
    if (type === 'toolCall' || type === 'tool_use') {
      const id = stringField(block, 'id') ?? `${messageId}:${String(index)}`
      blocks.push({
        type: 'tool_use',
        blockId: id,
        index,
        id,
        name: (stringField(block, 'name') ?? 'unknown').toLowerCase(),
        ...(block['arguments'] === undefined && block['input'] === undefined
          ? {}
          : { input: block['arguments'] ?? block['input'] }),
      })
    }
  })
  return blocks
}

function toolStartedEvent(
  messageId: string,
  block: Extract<ContentBlock, { type: 'tool_use' }>,
): AgentEvent {
  return block.input === undefined
    ? {
        type: 'tool.started',
        messageId,
        blockId: block.id,
        index: block.index,
        id: block.id,
        name: block.name,
      }
    : {
        type: 'tool.started',
        messageId,
        blockId: block.id,
        index: block.index,
        id: block.id,
        name: block.name,
        input: block.input,
      }
}

function imageFrom(block: Record<string, unknown>): {
  mime?: string
  url?: string
  b64?: string
  alt?: string
} {
  const source = asRecord(block['source']) ?? asRecord(block['image_url']) ?? block
  const url = stringField(source, 'url') ?? stringField(block, 'url')
  const b64 = stringField(source, 'data') ?? stringField(source, 'b64') ?? stringField(block, 'b64')
  const mime = stringField(source, 'media_type') ?? stringField(source, 'mime') ?? stringField(block, 'mime')
  const alt = stringField(block, 'alt')
  return {
    ...(mime === undefined ? {} : { mime }),
    ...(url === undefined ? {} : { url }),
    ...(b64 === undefined ? {} : { b64 }),
    ...(alt === undefined ? {} : { alt }),
  }
}

function toolOutput(record: Record<string, unknown>): string {
  const content = record['content']
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter(isRecord).map((block) => stringField(block, 'text') ?? '').join('')
  }
  const output = record['output']
  if (typeof output === 'string') return output
  if (content === undefined || content === null) return ''
  return JSON.stringify(content)
}

function isoFromTimestamp(value: number | null): string {
  if (value === null || value <= 0) return new Date(0).toISOString()
  return new Date(value).toISOString()
}
