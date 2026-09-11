import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { asRecord, isRecord, stringField } from '../../../core/event/json-record.js'
import type { ClaudeSdkMessage } from '../claude-event-mapper.js'
import { claudeTaskNotificationRecord } from './claude-task-notification.js'

/** The SDK's task_notification has no result or consumption identity. Read those from the native transcript. */
export class ClaudeTaskDeliveryReader {
  private path = ''
  private offset = 0
  private remainder = ''
  private decoder = new StringDecoder('utf8')
  private context: ClaudeSdkMessage[] = []
  private consecutiveNotice = false
  private readonly contexts = new Map<string, readonly ClaudeSdkMessage[]>()

  constructor(private readonly configDir: string, private readonly cwd: string) {}

  async start(sessionId: string): Promise<void> {
    if (!sessionId) return
    const path = join(this.configDir, 'projects', this.cwd.replace(/[^A-Za-z0-9]/gu, '-'), `${sessionId}.jsonl`)
    if (path === this.path) return
    this.path = path
    this.offset = 0
    this.remainder = ''
    this.decoder = new StringDecoder('utf8')
    this.context = []
    this.consecutiveNotice = false
    this.contexts.clear()
    try { this.offset = (await stat(path)).size } catch (error) { if (!missing(error)) throw error }
  }

  async forAssistant(messageId: string): Promise<readonly ClaudeSdkMessage[]> {
    if (!this.path) return []
    let file
    try { file = await open(this.path, 'r') } catch (error) { if (missing(error)) return []; throw error }
    try {
      const size = (await file.stat()).size
      if (size < this.offset) {
        this.offset = 0; this.remainder = ''; this.decoder = new StringDecoder('utf8')
        this.context = []; this.contexts.clear(); this.consecutiveNotice = false
      }
      const buffer = Buffer.alloc(64 * 1024)
      while (this.offset < size) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - this.offset), this.offset)
        if (!bytesRead) break
        this.offset += bytesRead
        const lines = (this.remainder + this.decoder.write(buffer.subarray(0, bytesRead))).split('\n')
        this.remainder = lines.pop() ?? ''
        for (const line of lines) if (line.trim()) this.record(asRecord(JSON.parse(line)))
      }
      return this.contexts.get(messageId) ?? this.context
    } finally { await file.close() }
  }

  private record(record: Record<string, unknown> | undefined): void {
    if (!record || record['parent_tool_use_id'] || record['isSidechain'] === true || record['is_sidechain'] === true) return
    const notification = claudeTaskNotificationRecord(record)
    const uuid = notification && stringField(notification, 'uuid')
    if (notification && uuid) {
      const notice: ClaudeSdkMessage = { type: 'user', uuid, message: notification['message'],
        origin: notification['origin'], ...(typeof notification['timestamp'] === 'string' ? { timestamp: notification['timestamp'] } : {}) }
      this.context = this.consecutiveNotice ? [...this.context, notice] : [notice]
      this.consecutiveNotice = true
      return
    }
    const message = asRecord(record['message'])
    const content = message?.['content']
    if (record['type'] === 'user') {
      const blocks = Array.isArray(content) ? content.filter(isRecord) : []
      if (blocks.some((block) => block['type'] === 'tool_result')) return
      const text = typeof content === 'string' ? content : blocks.map((block) => stringField(block, 'text') ?? '').join('')
      if (text.trim()) { this.context = []; this.consecutiveNotice = false }
    } else if (record['type'] === 'assistant' && typeof message?.['id'] === 'string') {
      this.contexts.set(message['id'], this.context)
      this.consecutiveNotice = false
    }
  }
}

function missing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' }
