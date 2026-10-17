export type UserMessageSurface =
  | "bubble"
  | "session-reset"
  | "conversation-compacted"
  | "hidden"

export type CompactPhase = "queued" | "compacting" | "compacted" | "failed" | "cancelled"

export type CompactMarker = {
  phase: CompactPhase
  summary?: string
  message?: string
}

type FoldableMessage = {
  id: string
  renderId?: string
  role: "user" | "assistant"
  content: string
  attachments?: readonly unknown[]
  status: "streaming" | "complete" | "error"
  blocks?: readonly unknown[]
  nestedAgents?: readonly unknown[]
  workflows?: readonly unknown[]
  compact?: CompactMarker
}

const LOCAL_COMMAND_STDOUT =
  /^\s*<local-command-stdout>[\s\S]*<\/local-command-stdout>\s*$/i
const LOCAL_COMMAND_CAVEAT =
  /^\s*<local-command-caveat>[\s\S]*<\/local-command-caveat>\s*$/i
const COMPACT_CONTINUATION =
  /^This session is being continued from a previous conversation/i

export function isClearCommandUserMessage(content: string): boolean {
  return isSlashCommandUserMessage(content, "clear")
}

export function isCompactCommandUserMessage(content: string): boolean {
  return isSlashCommandUserMessage(content, "compact")
}

export function isCompactContinuationSummary(content: string): boolean {
  return COMPACT_CONTINUATION.test(content.trim())
}

export function compactSummaryBody(content: string): string {
  const text = content.trim()
  const match = /^Summary:\s*\n([\s\S]+)/im.exec(text)
  const body = match?.[1]?.trim()
  return body && body !== "" ? body : text
}

export function userMessageSurface(
  content: string,
  compact?: CompactMarker,
  hasAttachments = false
): UserMessageSurface {
  if (hasAttachments) return "bubble"
  const text = content.trim()
  if (
    isSlashCommandUserMessage(text, "exit") ||
    isSlashCommandUserMessage(text, "config") ||
    LOCAL_COMMAND_STDOUT.test(text) ||
    LOCAL_COMMAND_CAVEAT.test(text) ||
    isCompactContinuationSummary(text)
  ) {
    return "hidden"
  }
  if (isClearCommandUserMessage(text)) return "session-reset"
  if (compact || isCompactCommandUserMessage(text)) return "conversation-compacted"
  return "bubble"
}

export function foldCommandSurfaces<T extends FoldableMessage>(
  messages: readonly T[]
): T[] {
  const summaries = pairCompactSummaries(messages)
  const folded: T[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message === undefined) continue

    if (message.role === "user") {
      const surface = userMessageSurface(message.content, message.compact, Boolean(message.attachments?.length))
      if (surface === "hidden") continue
      if (surface === "conversation-compacted") {
        const summary = summaries.get(message.id) ?? message.compact?.summary
        folded.push({
          ...message,
          compact: resolveCompactMarker(message, summary, messages, index),
        })
        continue
      }
      folded.push(message)
      continue
    }

    if (
      isNoResponseAssistant(message) ||
      isCompactPlaceholderAssistant(messages, index)
    ) {
      continue
    }
    folded.push(message)
  }

  return folded
}

function pairCompactSummaries(
  messages: readonly FoldableMessage[]
): Map<string, string> {
  const compactIndexes: Array<{ id: string; index: number }> = []
  const summaries: Array<{ id: string; index: number; body: string }> = []

  messages.forEach((message, index) => {
    if (message.role !== "user" || message.attachments?.length) return
    if (isCompactCommandUserMessage(message.content)) {
      compactIndexes.push({ id: message.id, index })
      return
    }
    if (isCompactContinuationSummary(message.content)) {
      summaries.push({
        id: message.id,
        index,
        body: compactSummaryBody(message.content),
      })
    }
  })

  const used = new Set<string>()
  const paired = new Map<string, string>()

  for (const compact of compactIndexes) {
    let best: (typeof summaries)[number] | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const summary of summaries) {
      if (used.has(summary.id)) continue
      const distance = Math.abs(summary.index - compact.index)
      if (distance < bestDistance) {
        best = summary
        bestDistance = distance
      }
    }
    if (best === undefined) continue
    used.add(best.id)
    paired.set(compact.id, best.body)
  }

  return paired
}

function resolveCompactMarker(
  message: FoldableMessage,
  summary: string | undefined,
  messages: readonly FoldableMessage[],
  compactIndex: number
): CompactMarker {
  if (message.compact && message.compact.phase !== "compacted") return message.compact
  const merged = summary?.trim() || message.compact?.summary?.trim()
  if (merged) {
    return { phase: "compacted", summary: merged }
  }
  if (message.compact) return message.compact
  return { phase: compactPhase(messages, compactIndex) }
}

function compactPhase(
  messages: readonly FoldableMessage[],
  compactIndex: number
): CompactPhase {
  for (let index = compactIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (message === undefined) continue
    if (message.role === "user") {
      const surface = userMessageSurface(message.content, message.compact, Boolean(message.attachments?.length))
      if (surface === "hidden") continue
      break
    }
    if (message.status === "error") return "failed"
    if (isPlaceholderAssistant(message) || message.status === "streaming") {
      return "compacting"
    }
    break
  }

  return "compacting"
}

function isCompactPlaceholderAssistant(
  messages: readonly FoldableMessage[],
  index: number
): boolean {
  const message = messages[index]
  if (message === undefined || !isPlaceholderAssistant(message)) return false

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = messages[cursor]
    if (previous === undefined) continue
    if (previous.role === "user") {
      const surface = userMessageSurface(previous.content, previous.compact, Boolean(previous.attachments?.length))
      if (surface === "hidden") continue
      return surface === "conversation-compacted"
    }
    if (!isPlaceholderAssistant(previous)) return false
  }

  return false
}

function isNoResponseAssistant(message: FoldableMessage): boolean {
  return (
    message.role === "assistant" &&
    message.status !== "error" &&
    message.content.trim() === "No response requested." &&
    (message.blocks?.length ?? 0) === 0 &&
    (message.nestedAgents?.length ?? 0) === 0 &&
    (message.workflows?.length ?? 0) === 0
  )
}

function isPlaceholderAssistant(message: FoldableMessage): boolean {
  if (message.role !== "assistant" || message.status === "error") return false
  if (
    message.content.trim() !== "" &&
    message.content.trim() !== "No response requested."
  ) {
    return false
  }
  return (
    (message.blocks?.length ?? 0) === 0 &&
    (message.nestedAgents?.length ?? 0) === 0 &&
    (message.workflows?.length ?? 0) === 0
  )
}

export function applyThreadCompactFrame<T extends FoldableMessage>(
  messages: readonly T[],
  assistantId: string,
  frame: {
    type?: string
    summary?: string
    message?: string
    reason?: "manual" | "auto"
    compactMessage?: T
    compactAfterMessageId?: string
  }
): T[] {
  if (frame.compactMessage) {
    const marker = frame.compactMessage
    const existingIndex = messages.findIndex((message) => sameMessage(message, marker))
    if (existingIndex >= 0) {
      return messages.map((message, index) => index === existingIndex ? {
        ...marker,
        renderId: message.renderId ?? message.id,
        compact: reconcileCompactMarker(message.compact, marker.compact),
      } : message)
    }
    const anchor = frame.compactAfterMessageId
    const anchorIndex = anchor === undefined ? -1 : messages.findIndex((message) => hasMessageId(message, anchor))
    const index = anchor !== undefined && anchorIndex < 0 ? messages.length : anchorIndex + 1
    return [...messages.slice(0, index), marker, ...messages.slice(index)]
  }
  // A raw event may only address the manual command belonging to this run.
  // Automatic compaction requires the session's explicit marker identity.
  if (frame.reason === "auto") return [...messages]
  const index = manualCompactIndex(messages, assistantId)
  if (index < 0) return [...messages]
  const previous = messages[index]?.compact
  let patch: CompactMarker
  if (frame.type === "run.started" || frame.type === "session.compacting") patch = { phase: "compacting" }
  else if (frame.type === "session.compacted") patch = { phase: "compacted", ...(frame.summary?.trim() ? { summary: frame.summary.trim() } : {}) }
  else if (frame.type === "session.compaction_failed" || frame.type === "error" || frame.type === "run.failed") patch = { phase: "failed", ...(frame.message ? { message: frame.message } : {}) }
  else if (frame.type === "session.compaction_cancelled" || frame.type === "run.aborted") patch = { phase: "cancelled", ...(frame.message ? { message: frame.message } : {}) }
  else return [...messages]
  if (previous && isSettledCompact(previous)) return [...messages]
  return messages.map((message, position) => position === index ? { ...message, compact: patch } : message)
}

function manualCompactIndex(messages: readonly FoldableMessage[], assistantId: string): number {
  if (!assistantId) return -1
  const isManual = (message: FoldableMessage) => message.role === "user" && !message.attachments?.length && isCompactCommandUserMessage(message.content)
  const exact = messages.findIndex((message) => hasMessageId(message, `${assistantId}:user`) && isManual(message))
  if (exact >= 0) return exact
  const assistantIndex = messages.findIndex((message) => message.role === "assistant" && hasMessageId(message, assistantId))
  const preceding = messages[assistantIndex - 1]
  return preceding && isManual(preceding) ? assistantIndex - 1 : -1
}

function hasMessageId(message: FoldableMessage, id: string): boolean {
  return message.id === id || message.renderId === id
}

function sameMessage(left: FoldableMessage, right: FoldableMessage): boolean {
  return hasMessageId(left, right.id) || (right.renderId !== undefined && hasMessageId(left, right.renderId))
}

function isSettledCompact(marker: CompactMarker): boolean {
  return marker.phase === "compacted" || marker.phase === "failed" || marker.phase === "cancelled"
}

/** A snapshot may lag the live event for the same marker, but a new ID is a new compaction. */
export function reconcileCompactMarker(
  previous: CompactMarker | undefined,
  incoming: CompactMarker | undefined
): CompactMarker | undefined {
  if (previous && isSettledCompact(previous) && (!incoming || !isSettledCompact(incoming))) return previous
  if (previous?.phase === "compacted" && incoming?.phase === "compacted" && !incoming.summary && previous.summary) return { ...incoming, summary: previous.summary }
  return incoming
}

function isSlashCommandUserMessage(content: string, name: string): boolean {
  const text = content.trim()
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const plain = new RegExp(`^/${escaped}(?:\\s|$)`, "i")
  if (plain.test(text)) return true
  const envelope = new RegExp(
    `<command-name>\\s*/?${escaped}\\s*</command-name>[\\s\\S]*<command-message>\\s*${escaped}\\s*</command-message>|<command-message>\\s*${escaped}\\s*</command-message>[\\s\\S]*<command-name>\\s*/?${escaped}\\s*</command-name>`,
    "i"
  )
  return envelope.test(text)
}
