import type { AgentEvent } from '../../core/event/agent-event.js'
import { isCompactCommandContent, isCompactTerminal, mergeCompactMarker, normalizeCompactCommandContent, type CompactMarker } from '../../core/resource/compact-command.js'
import { textFromThreadBlocks, threadHasVisibleContent, type ThreadBlock, type ThreadMessage } from '../../core/resource/thread.js'

interface Operation {
  message: ThreadMessage & { readonly compact: CompactMarker }
  readonly runId: string
  readonly beforeIds: Set<string>
  readonly predecessors: readonly ThreadMessage[]
  readonly command?: string
}

export interface CompactionUpdate {
  readonly messages: readonly ThreadMessage[]
  readonly compactMessage: ThreadMessage
  readonly compactAfterMessageId?: string
}

/** Keeps live compaction facts while native transcripts catch up with their own IDs. */
export class SessionCompaction {
  private readonly operations: Operation[] = []
  private active: Operation | undefined

  apply(messages: readonly ThreadMessage[], event: AgentEvent, runId: string, command: ThreadMessage | undefined,
    id: string, createdAt: string): CompactionUpdate | undefined {
    const patch = compactPatch(event)
    const ended = event.type === 'run.failed' || event.type === 'run.aborted' || event.type === 'run.completed'
    if (!patch && !ended) return undefined
    let operation = this.active?.runId === runId ? this.active : undefined
    const manual = command && !command.attachments?.length && isCompactCommandContent(command.content) ? command : undefined
    if (ended) {
      operation ??= [...this.operations].reverse().find((item) => item.runId === runId && !isCompactTerminal(item.message.compact))
      if (!operation && (!manual || (manual.compact && isCompactTerminal(manual.compact)))) return undefined
    } else if (event.type !== 'session.compacting') {
      // Some providers send the boundary first and its summary second.
      operation ??= [...this.operations].reverse().find((item) => item.runId === runId)
    }
    if (!operation) {
      const existing = manual && !('reason' in event && event.reason === 'auto')
        ? messages.find((message) => sameMessage(message, manual)) ?? manual : undefined
      const index = existing ? messages.findIndex((message) => sameMessage(message, existing)) : -1
      const predecessors = (index >= 0 ? messages.slice(0, index) : messages).filter(threadHasVisibleContent)
      const message = { ...(existing ?? { id, role: 'user' as const, content: '/compact', status: 'complete' as const, createdAt }),
        compact: existing?.compact ?? { phase: 'queued' as const } }
      const normalized = existing && normalizeCompactCommandContent(existing.content)
      operation = { message, runId, beforeIds: new Set(messages.map((item) => item.id)), predecessors,
        ...(normalized ? { command: normalized } : {}) }
      this.operations.push(operation)
    }
    const result: CompactMarker = patch ?? (event.type === 'run.aborted'
      ? { phase: 'cancelled', ...('message' in event && event.message ? { message: event.message } : {}) }
      : { phase: 'failed', message: event.type === 'run.failed' ? event.message : 'Compaction ended without a result' })
    operation.message = { ...operation.message, compact: mergeCompactMarker(operation.message.compact, result) }
    this.active = isCompactTerminal(operation.message.compact) ? undefined : operation
    const next = this.insert(messages, operation)
    const index = next.findIndex((message) => sameMessage(message, operation.message))
    const after = next[index - 1]?.id
    return { messages: next, compactMessage: operation.message, ...(after ? { compactAfterMessageId: after } : {}) }
  }

  reconcile(history: readonly ThreadMessage[]): readonly ThreadMessage[] {
    let messages = [...history]
    const claimed = new Set<string>()
    for (const operation of this.operations) {
      const native = history.find((message) => sameMessage(message, operation.message)) ?? history.find((message) =>
        message.compact && !claimed.has(message.id) && !operation.beforeIds.has(message.id) &&
        // Failed attempts often have no native entry. They must not consume the
        // next successful compaction merely because it is the next new marker.
        (!(operation.message.compact.phase === 'failed' || operation.message.compact.phase === 'cancelled') ||
          message.compact.phase === operation.message.compact.phase || (operation.command && message.compact.phase === 'queued')) &&
        (!operation.command || normalizeCompactCommandContent(message.content) === operation.command))
      if (native) {
        claimed.add(native.id)
        const compact = mergeCompactMarker(native.compact, operation.message.compact)
        operation.message = { ...native, renderId: operation.message.renderId ?? operation.message.id, compact }
        messages = messages.map((message) => message.id === native.id ? operation.message : message)
        if (this.active === operation && isCompactTerminal(compact)) this.active = undefined
      } else {
        messages = [...this.insert(messages, operation)]
      }
    }
    return messages
  }

  private insert(messages: readonly ThreadMessage[], operation: Operation): readonly ThreadMessage[] {
    if (messages.some((message) => sameMessage(message, operation.message))) {
      return messages.map((message) => sameMessage(message, operation.message) ? operation.message : message)
    }
    let index = -1
    const pending: ThreadMessage[] = []
    for (const predecessor of [...operation.predecessors].reverse()) {
      index = messages.findIndex((message) => sameMessage(message, predecessor) ||
        (message.transcriptUuid && message.transcriptUuid === predecessor.transcriptUuid))
      if (predecessor.role === 'assistant' && predecessor.blocks?.length) {
        const count = predecessor.blocks.length
        const combined = (message: ThreadMessage) => message.role === 'assistant' &&
          Date.parse(message.createdAt) <= Date.parse(operation.message.createdAt) &&
          (message.blocks?.length ?? 0) > count && predecessor.blocks?.every((block, position) => sameBlock(block, message.blocks?.[position]))
        const known = messages[index]
        const nativeIndex = index >= 0 ? (known && combined(known) ? index : -1) : messages.findIndex(combined)
        const native = messages[nativeIndex]
        if (native?.blocks) {
          // Failed/cancelled compactions have no native entry: replay joins the
          // surrounding answers. Recover the known boundary without duplicating its prefix.
          const before = { ...messageSlice(native, native.blocks.slice(0, count), false),
            id: predecessor.id === native.id ? `${predecessor.id}:before:${operation.message.id}` : predecessor.id,
            renderId: predecessor.renderId ?? predecessor.id, status: 'complete' as const }
          const after = { ...messageSlice(native, native.blocks.slice(count), true),
            renderId: `${operation.runId}:after:${operation.message.renderId ?? operation.message.id}` }
          const next = [...messages]
          next.splice(nativeIndex, 1, before, ...pending, operation.message, after)
          return next
        }
      }
      if (index < 0 && !predecessor.compact && predecessor.content.trim()) {
        // Native IDs can replace provisional turn IDs. Like the terminal text
        // projection, correlate their ordered text within the operation's time.
        for (let cursor = messages.length - 1; cursor >= 0; cursor--) {
          const candidate = messages[cursor]
          if (candidate?.role === predecessor.role && candidate.content === predecessor.content &&
            Date.parse(candidate.createdAt) <= Date.parse(operation.message.createdAt)) { index = cursor; break }
        }
      }
      if (index >= 0) break
      pending.unshift(predecessor)
    }
    const next = [...messages]
    next.splice(index + 1, 0, ...pending, operation.message)
    return next
  }
}

function sameBlock(left: ThreadBlock, right: ThreadBlock | undefined): boolean {
  if (left.type !== right?.type) return false
  if (left.type === 'text' || left.type === 'thinking') return 'text' in right && left.text === right.text
  if (left.type === 'tool_use') return right.type === 'tool_use' && left.id === right.id
  return left.blockId === right.blockId
}

function messageSlice(message: ThreadMessage, blocks: readonly ThreadBlock[], includeUnowned: boolean): ThreadMessage {
  const tools = new Set(blocks.flatMap((block) => block.type === 'tool_use' ? [block.id] : []))
  return { ...message, blocks, content: textFromThreadBlocks(blocks),
    ...(message.nestedAgents ? { nestedAgents: message.nestedAgents.filter((agent) => tools.has(agent.parentToolUseId)) } : {}),
    ...(message.workflows ? { workflows: message.workflows.filter((workflow) => tools.has(workflow.workflowToolUseId)) } : {}),
    ...(message.interactions ? { interactions: message.interactions.filter(({ request }) => request.toolUseId ? tools.has(request.toolUseId) : includeUnowned) } : {}) }
}

function sameMessage(left: ThreadMessage, right: ThreadMessage): boolean {
  return left.id === right.id || (left.renderId ?? left.id) === (right.renderId ?? right.id)
}

function compactPatch(event: AgentEvent): CompactMarker | undefined {
  switch (event.type) {
    case 'session.compacting': return { phase: 'compacting' }
    case 'session.compacted': return { phase: 'compacted', ...(event.summary ? { summary: event.summary } : {}) }
    case 'session.compaction_failed': return { phase: 'failed', message: event.message }
    case 'session.compaction_cancelled': return { phase: 'cancelled', ...(event.message ? { message: event.message } : {}) }
    default: return undefined
  }
}
