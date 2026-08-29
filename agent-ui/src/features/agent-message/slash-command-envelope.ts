export type UserMessageSurface =
  | "bubble"
  | "session-reset"
  | "conversation-compacted"
  | "hidden"

export type CompactPhase = "compacting" | "compacted"

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

export function userMessageSurface(content: string): UserMessageSurface {
  const text = content.trim()
  if (
    LOCAL_COMMAND_STDOUT.test(text) ||
    LOCAL_COMMAND_CAVEAT.test(text) ||
    isCompactContinuationSummary(text)
  ) {
    return "hidden"
  }
  if (isClearCommandUserMessage(text)) return "session-reset"
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
      const surface = userMessageSurface(message.content)
      if (surface === "hidden") continue
      if (surface === "conversation-compacted") {
        const summary = summaries.get(message.id)
        folded.push({
          ...message,
          compact: {
            phase: compactPhase(summary, messages, index),
            ...(summary === undefined ? {} : { summary }),
          },
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

function compactPhase(
  summary: string | undefined,
  messages: readonly FoldableMessage[],
  compactIndex: number
): CompactPhase {
  if (summary !== undefined && summary.trim() !== "") return "compacted"

  for (let index = compactIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (message === undefined) continue
    if (message.role === "user") {
      const surface = userMessageSurface(message.content)
      if (surface === "hidden") continue
      break
    }
    if (message.status === "error") break
    if (isPlaceholderAssistant(message) || message.status === "streaming") {
      return "compacting"
    }
    break
  }

  return "compacted"
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
      const surface = userMessageSurface(previous.content)
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
