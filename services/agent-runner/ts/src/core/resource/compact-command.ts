export type CompactPhase = 'compacting' | 'compacted' | 'failed'

export interface CompactMarker {
  readonly phase: CompactPhase
  readonly summary?: string
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
  const match = COMPACT_PLAIN.exec(content.trim())
  const instructions = match?.[1]?.trim()
  return instructions === undefined || instructions === '' ? undefined : instructions
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
  if (patch.phase === 'failed' || previous?.phase === 'failed') {
    return { phase: 'failed' }
  }
  const summary = nonEmpty(patch.summary) ?? nonEmpty(previous?.summary)
  if (patch.phase === 'compacted' || summary !== undefined) {
    return summary === undefined
      ? { phase: 'compacted' }
      : { phase: 'compacted', summary }
  }
  return { phase: 'compacting' }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}
