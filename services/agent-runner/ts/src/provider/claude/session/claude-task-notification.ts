import { asRecord, isRecord, stringField, type JsonRecord } from '../../../core/event/json-record.js'
import { taskNotification } from '../../../core/resource/background-task.js'

/** Queued-command attachments are consumed inputs; queue-operation records are only queue bookkeeping. */
export function claudeTaskNotificationRecord(record: JsonRecord): JsonRecord | undefined {
  if (record['isSidechain'] === true || record['is_sidechain'] === true || record['parent_tool_use_id']) return undefined
  if (!stringField(record, 'uuid')) return undefined
  if (record['type'] === 'attachment') {
    const attachment = asRecord(record['attachment'])
    if (attachment?.['type'] !== 'queued_command' || attachment['commandMode'] !== 'task-notification') return undefined
    const content = stringField(attachment, 'prompt') ?? ''
    // Preserve the provider provenance while exposing both native forms to the shared message mapper.
    const origin = { kind: 'task-notification', delivery: 'absorbed_mid_turn' }
    if (!taskNotification(origin, content)) return undefined
    return { ...record, type: 'user', origin, message: { role: 'user', content } }
  }
  if (record['type'] !== 'user') return undefined
  const content = asRecord(record['message'])?.['content']
  const blocks = Array.isArray(content) ? content.filter(isRecord) : []
  if (blocks.some((block) => block['type'] === 'tool_result')) return undefined
  const text = typeof content === 'string' ? content : blocks.map((block) => stringField(block, 'text') ?? '').join('')
  return taskNotification(record['origin'], text) ? record : undefined
}
