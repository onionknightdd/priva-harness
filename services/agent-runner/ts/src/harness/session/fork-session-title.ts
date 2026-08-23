export function sessionStem(session: {
  readonly customTitle: string | null
  readonly summary: string
  readonly firstPrompt: string | null
  readonly sessionId?: string
}): string {
  const customTitle = session.customTitle?.trim() ?? ''
  if (customTitle !== '') return customTitle
  const summary = session.summary.trim()
  if (summary !== '') return summary
  const firstPrompt = session.firstPrompt?.trim() ?? ''
  if (firstPrompt !== '') return firstPrompt
  return session.sessionId?.trim() ?? ''
}

export function nextForkTitle(stem: string, titles: readonly string[]): string {
  const trimmed = stem.trim()
  if (trimmed === '') {
    throw new Error('Fork title stem must be a non-empty string')
  }
  const pattern = new RegExp(`^${escapeRegExp(trimmed)} \\((\\d+)\\)$`)
  let max = 0
  for (const title of titles) {
    const match = pattern.exec(title.trim())
    if (match === null) continue
    const value = Number(match[1])
    if (Number.isInteger(value) && value > max) max = value
  }
  return `${trimmed} (${max + 1})`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
