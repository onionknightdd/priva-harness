export type CompactPhase = 'queued' | 'compacting' | 'compacted' | 'failed' | 'cancelled'

export interface CompactMarker {
  readonly phase: CompactPhase
  readonly summary?: string
  readonly message?: string
}

const LOCAL_COMMAND_STDOUT =
  /^\s*<local-command-stdout>[\s\S]*<\/local-command-stdout>\s*$/i
const LOCAL_COMMAND_CAVEAT =
  /^\s*<local-command-caveat>[\s\S]*<\/local-command-caveat>\s*$/i
const COMPACT_CONTINUATION =
  /^This session is being continued from a previous conversation/i
const COMPACT_PLAIN = /^\/compact(?:\s+([\s\S]*))?$/i
const COMPACT_ENVELOPE =
  /<command-name>\s*\/?compact\s*<\/command-name>[\s\S]*<command-message>\s*compact\s*<\/command-message>|<command-message>\s*compact\s*<\/command-message>[\s\S]*<command-name>\s*\/?compact\s*<\/command-name>/i

export function isCompactCommandContent(content: string): boolean {
  const text = content.trim()
  return COMPACT_PLAIN.test(text) || COMPACT_ENVELOPE.test(text)
}

export function compactInstructionsOf(content: string): string | undefined {
  const text = content.trim()
  const match = COMPACT_PLAIN.exec(text)
  const instructions = (match?.[1] ?? (COMPACT_ENVELOPE.test(text)
    ? /<command-args>([\s\S]*?)<\/command-args>/i.exec(text)?.[1]
    : undefined))?.trim()
  return instructions === undefined || instructions === '' ? undefined : instructions
}

export function normalizeCompactCommandContent(content: string): string | undefined {
  if (!isCompactCommandContent(content)) return undefined
  const instructions = compactInstructionsOf(content)
  return instructions === undefined ? '/compact' : `/compact ${instructions}`
}

export function isCompactContinuationContent(content: string): boolean {
  return COMPACT_CONTINUATION.test(content.trim())
}

export function isHiddenCompactUserContent(content: string): boolean {
  const text = content.trim()
  return (
    LOCAL_COMMAND_STDOUT.test(text) ||
    LOCAL_COMMAND_CAVEAT.test(text) ||
    isCompactContinuationContent(text)
  )
}

export function compactSummaryBody(content: string): string {
  const text = content.trim()
  const match = /^Summary:\s*\n([\s\S]+)/im.exec(text)
  const body = match?.[1]?.trim()
  return body !== undefined && body !== '' ? body : text
}

export function mergeCompactMarker(
  previous: CompactMarker | undefined,
  patch: CompactMarker,
): CompactMarker {
  // A later snapshot or repeated start cannot reopen the same operation.
  if (previous && isCompactTerminal(previous) && !isCompactTerminal(patch)) return previous
  if (patch.phase === 'failed' || patch.phase === 'cancelled') return patch
  if (previous && (previous.phase === 'failed' || previous.phase === 'cancelled')) return previous
  const summary = nonEmpty(patch.summary) ?? nonEmpty(previous?.summary)
  if (patch.phase === 'compacted' || previous?.phase === 'compacted' || summary !== undefined) {
    return summary === undefined
      ? { phase: 'compacted' }
      : { phase: 'compacted', summary }
  }
  return { phase: patch.phase }
}

export function isCompactTerminal(marker: CompactMarker): boolean {
  return marker.phase === 'compacted' || marker.phase === 'failed' || marker.phase === 'cancelled'
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}
