import type { TerminalTextDelta } from '../../core/contract/terminal-service.js'
import { emptyAssistantMessage } from '../../core/resource/apply-stream-frame.js'
import { taskNotificationFields } from '../../core/resource/background-task.js'
import { textFromThreadBlocks, type ThreadBlock, type ThreadMessage } from '../../core/resource/thread.js'

/** Display IDs differ from transcript IDs. Reconcile their ordered text prefixes. */
export class TerminalTextProjection {
  private readonly chunks = new Map<string, Map<number, TerminalTextDelta>>()
  private readonly previousUsers: Set<string>
  private userId: string | undefined
  private turnId: string | undefined
  private readonly notificationTaskId: string | undefined
  finished = false

  constructor(readonly runId: string, private readonly user: ThreadMessage, history: readonly ThreadMessage[], private readonly nativePrompt = false) {
    this.notificationTaskId = nativePrompt ? taskNotificationFields(user.content)?.['task_id'] : undefined
    // A recovered prompt can already have an assistant/tool prefix on disk.
    // Anchor against the persisted prompt time, not the runner restart time.
    this.previousUsers = new Set(history.filter((message) => message.role === 'user' &&
      Date.parse(message.createdAt) < Date.parse(user.createdAt)).map((message) => message.id))
  }

  append(delta: TerminalTextDelta): boolean {
    if (this.turnId && this.turnId !== delta.turnId) return false
    this.turnId = delta.turnId
    let chunks = this.chunks.get(delta.messageId)
    if (!chunks) { chunks = new Map(); this.chunks.set(delta.messageId, chunks) }
    if (chunks.has(delta.index)) return false
    chunks.set(delta.index, delta)
    return true
  }

  merge(history: readonly ThreadMessage[]): readonly ThreadMessage[] {
    this.userId ??= history.find((message) => message.role === 'user' && !this.previousUsers.has(message.id) && message.content === this.user.content)?.id
    const userIndex = this.userId ? history.findIndex((message) => message.id === this.userId) : -1
    let nativeIndex = -1
    let replyStart = 0
    if (userIndex >= 0 && history[userIndex + 1]?.role === 'assistant') nativeIndex = userIndex + 1
    if (this.nativePrompt && userIndex < 0) {
      let deliveredAt = ''
      for (const [index, message] of history.entries()) for (const [blockIndex, block] of (message.blocks ?? []).entries()) {
        if (block.type !== 'task_notification' || block.notification.task.taskId !== this.notificationTaskId) continue
        const createdAt = block.notification.createdAt ?? ''
        if (createdAt < deliveredAt) continue
        deliveredAt = createdAt
        nativeIndex = index
        replyStart = blockIndex + 1
      }
      // The hook and display flush can precede the native delivery. Keep the
      // chunks until its card arrives instead of inventing a user/assistant pair.
      if (nativeIndex < 0) return history
    }
    const native = history[nativeIndex]
    const texts = [...this.chunks.entries()].map(([id, chunks]) => {
      let text = ''
      for (let index = 0; chunks.has(index); index++) text += chunks.get(index)?.text ?? ''
      return { id, text }
    })
    // Transcript blocks may precede or follow display flushes and include tools
    // between text messages. Consume matching text in order, never by ID.
    let persisted = (native?.blocks ?? []).slice(replyStart).filter((block) => block.type === 'text').map((block) => block.text).join('')
    const tail: ThreadBlock[] = []
    for (const { id, text } of texts) {
      if (!text) continue
      if (persisted.startsWith(text)) { persisted = persisted.slice(text.length); continue }
      if (text.startsWith(persisted)) {
        const suffix = text.slice(persisted.length)
        persisted = ''
        if (suffix) tail.push({ type: 'text', blockId: `display:${id}`, index: (native?.blocks?.length ?? 0) + tail.length, text: suffix })
      }
      // A native transformation is authoritative; do not duplicate mismatched text.
    }
    const base = native ?? emptyAssistantMessage(this.runId, this.user.createdAt)
    const blocks = [...(base.blocks ?? []), ...tail]
    const message: ThreadMessage = { ...base, blocks, content: textFromThreadBlocks(blocks), status: this.finished ? 'complete' : 'streaming' }
    if (userIndex < 0 && !this.nativePrompt) return [...history, this.user, message]
    const result = [...history]
    result.splice(nativeIndex >= 0 ? nativeIndex : userIndex + 1, native ? 1 : 0, message)
    return result
  }
}
