export const SLASH_KINDS = ['command', 'skill'] as const

export type SlashKind = (typeof SLASH_KINDS)[number]

export const SLASH_ORIGINS = ['builtin', 'user', 'project'] as const

export type SlashOrigin = (typeof SLASH_ORIGINS)[number]

export interface SlashCommand {
  readonly name: string
  readonly description: string
  readonly argumentHint?: string
  readonly aliases?: readonly string[]
  readonly kind: SlashKind
  readonly origin: SlashOrigin
}

const ORIGIN_RANK: Readonly<Record<SlashOrigin, number>> = {
  builtin: 0,
  user: 1,
  project: 2,
}

export function isSlashKind(value: unknown): value is SlashKind {
  return typeof value === 'string' && (SLASH_KINDS as readonly string[]).includes(value)
}

export function isSlashOrigin(value: unknown): value is SlashOrigin {
  return typeof value === 'string' && (SLASH_ORIGINS as readonly string[]).includes(value)
}

export function isExcludedSlashName(name: string): boolean {
  return name.startsWith('mcp__') || name.includes(':')
}

export function compareSlashCommands(left: SlashCommand, right: SlashCommand): number {
  return left.name.localeCompare(right.name)
}

export function mergeSlashCommands(entries: readonly SlashCommand[]): SlashCommand[] {
  const byName = new Map<string, SlashCommand>()
  for (const entry of entries) {
    if (isExcludedSlashName(entry.name)) continue
    const current = byName.get(entry.name)
    if (current === undefined || ORIGIN_RANK[entry.origin] >= ORIGIN_RANK[current.origin]) {
      byName.set(entry.name, entry)
    }
  }
  return [...byName.values()].sort(compareSlashCommands)
}
