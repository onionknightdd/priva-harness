export type UserMessageSurface =
  | "bubble"
  | "session-reset"
  | "conversation-compacted"
  | "hidden"

export type CompactPhase = "compacting" | "compacted" | "failed"

export type CompactMarker = {
  phase: CompactPhase
  summary?: string
}

type FoldableMessage = {
  id: string
  role: "user" | "assistant"
  content: string
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
  compact?: CompactMarker
): UserMessageSurface {
  const text = content.trim()
  if (
    LOCAL_COMMAND_STDOUT.test(text) ||
    LOCAL_COMMAND_CAVEAT.test(text) ||
    isCompactContinuationSummary(text)
  ) {
    return "hidden"
  }
  if (isClearCommandUserMessage(text)) return "session-reset"
  if (compact?.phase === "failed") return "bubble"
  if (isCompactCommandUserMessage(text)) return "conversation-compacted"
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
      const surface = userMessageSurface(message.content, message.compact)
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
    if (message.role !== "user") return
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
  if (message.compact?.phase === "failed") {
    return { phase: "failed" }
  }
  const merged = summary?.trim() || message.compact?.summary?.trim()
  if (merged) {
    return { phase: "compacted", summary: merged }
  }
  if (message.compact?.phase === "compacting" || message.compact?.phase === "compacted") {
    return { phase: message.compact.phase }
  }
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
      const surface = userMessageSurface(message.content, message.compact)
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
      const surface = userMessageSurface(previous.content, previous.compact)
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
  frame: { type?: string; summary?: string; message?: string }
): T[] {
  if (frame.type === "session.compacting") {
    return patchCompactUser(messages, { phase: "compacting" })
  }
  if (frame.type === "session.compacted") {
    const summary = frame.summary?.trim()
    return patchCompactUser(
      messages.map((message) =>
        message.id === assistantId && message.status === "streaming"
          ? { ...message, status: "complete" as const }
          : message
      ),
      summary ? { phase: "compacted", summary } : { phase: "compacted" }
    )
  }
  if (frame.type === "error" || frame.type === "run.failed") {
    return failActiveCompact(messages, assistantId)
  }
  return [...messages]
}

function patchCompactUser<T extends FoldableMessage>(
  messages: readonly T[],
  patch: CompactMarker
): T[] {
  const index = lastCompactUserIndex(messages)
  if (index === undefined) return [...messages]
  return messages.map((message, position) =>
    position === index
      ? { ...message, compact: mergeCompact(message.compact, patch) }
      : message
  )
}

function failActiveCompact<T extends FoldableMessage>(
  messages: readonly T[],
  assistantId: string
): T[] {
  const assistantIndex = messages.findIndex((message) => message.id === assistantId)
  if (assistantIndex < 0) return [...messages]
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.role !== "user") continue
    if (message.compact?.phase === "compacted") return [...messages]
    if (
      message.compact?.phase === "compacting" ||
      isCompactCommandUserMessage(message.content)
    ) {
      return messages.map((item, position) =>
        position === index ? { ...item, compact: { phase: "failed" } } : item
      )
    }
    return [...messages]
  }
  return [...messages]
}

function lastCompactUserIndex(
  messages: readonly FoldableMessage[]
): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.role !== "user") continue
    if (message.compact !== undefined || isCompactCommandUserMessage(message.content)) {
      return index
    }
  }
  return undefined
}

function mergeCompact(
  previous: CompactMarker | undefined,
  patch: CompactMarker
): CompactMarker {
  if (patch.phase === "failed" || previous?.phase === "failed") {
    return { phase: "failed" }
  }
  const summary = patch.summary?.trim() || previous?.summary?.trim()
  if (patch.phase === "compacted" || summary) {
    return summary ? { phase: "compacted", summary } : { phase: "compacted" }
  }
  return summary ? { phase: "compacting", summary } : { phase: "compacting" }
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
