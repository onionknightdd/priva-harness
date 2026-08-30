import { asRecord, numberField } from '../event/json-record.js'

export const CONTEXT_USAGE_CATEGORY_IDS = [
  'systemPrompt',
  'toolDefinitions',
  'skills',
  'mcpTools',
  'subagentDefinitions',
  'memory',
  'conversation',
] as const

export type ContextUsageCategoryId = (typeof CONTEXT_USAGE_CATEGORY_IDS)[number]

export interface ContextUsageCategory {
  readonly id: ContextUsageCategoryId
  readonly tokens: number | null
}

export interface ContextUsage {
  readonly used: number | null
  readonly limit: number | null
  readonly categories: readonly ContextUsageCategory[]
}

export interface PiContextUsageSource {
  readonly tokens: number | null
  readonly contextWindow: number
}

const CLAUDE_CATEGORY_IDS: Readonly<Record<string, ContextUsageCategoryId>> = {
  'system prompt': 'systemPrompt',
  'system tools': 'toolDefinitions',
  skills: 'skills',
  'mcp tools': 'mcpTools',
  'custom agents': 'subagentDefinitions',
  agents: 'subagentDefinitions',
  'memory files': 'memory',
  memory: 'memory',
  messages: 'conversation',
}

export function emptyContextUsage(): ContextUsage {
  return {
    used: null,
    limit: null,
    categories: CONTEXT_USAGE_CATEGORY_IDS.map((id) => ({ id, tokens: null })),
  }
}

export function mapClaudeContextUsage(raw: unknown): ContextUsage {
  const record = asRecord(raw)
  if (record === undefined) return emptyContextUsage()
  const used = numberField(record, 'totalTokens') ?? null
  const maxTokens = numberField(record, 'maxTokens')
  const tokensById = new Map<ContextUsageCategoryId, number>()
  const categories = record['categories']
  if (Array.isArray(categories)) {
    for (const item of categories) {
      const row = asRecord(item)
      if (row === undefined) continue
      const name = row['name']
      if (typeof name !== 'string') continue
      const id = CLAUDE_CATEGORY_IDS[name.trim().toLowerCase()]
      const tokens = numberField(row, 'tokens')
      if (id === undefined || tokens === undefined) continue
      tokensById.set(id, (tokensById.get(id) ?? 0) + tokens)
    }
  }
  return {
    used,
    limit: maxTokens !== undefined && maxTokens > 0 ? maxTokens : null,
    categories: CONTEXT_USAGE_CATEGORY_IDS.map((id) => ({
      id,
      tokens: tokensById.get(id) ?? null,
    })),
  }
}

export function mapPiContextUsage(usage: PiContextUsageSource | undefined): ContextUsage {
  if (usage === undefined) return emptyContextUsage()
  return {
    used: usage.tokens,
    limit: usage.contextWindow > 0 ? usage.contextWindow : null,
    categories: CONTEXT_USAGE_CATEGORY_IDS.map((id) => ({ id, tokens: null })),
  }
}
