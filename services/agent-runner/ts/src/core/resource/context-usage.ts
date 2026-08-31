import { asRecord, numberField, stringField, type JsonRecord } from '../event/json-record.js'

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
  tools: 'toolDefinitions',
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
  const used = numberField(record, 'totalTokens') ?? numberField(record, 'total_tokens') ?? null
  const maxTokens = numberField(record, 'maxTokens')
    ?? numberField(record, 'rawMaxTokens')
    ?? numberField(record, 'raw_max_tokens')
  const tokensById = new Map<ContextUsageCategoryId, number>()
  const categories = record['categories']
  if (Array.isArray(categories)) {
    for (const item of categories) {
      const row = asRecord(item)
      if (row === undefined) continue
      const name = stringField(row, 'name')
      if (name === undefined) continue
      const id = claudeCategoryIdOf(name, row)
      const tokens = numberField(row, 'tokens')
      if (id === undefined || tokens === undefined) continue
      tokensById.set(id, (tokensById.get(id) ?? 0) + tokens)
    }
  }
  assignFallback(tokensById, 'toolDefinitions', record['systemTools'] ?? record['system_tools'])
  assignFallback(tokensById, 'mcpTools', record['mcpTools'] ?? record['mcp_tools'])
  assignUnaccountedTools(tokensById, used)
  return {
    used,
    limit: maxTokens !== undefined && maxTokens > 0 ? maxTokens : null,
    categories: CONTEXT_USAGE_CATEGORY_IDS.map((id) => ({
      id,
      tokens: tokensById.get(id) ?? null,
    })),
  }
}

function claudeCategoryIdOf(name: string, row: JsonRecord): ContextUsageCategoryId | undefined {
  const kind = stringField(row, 'kind')
  if (kind === 'free' || kind === 'buffer') return undefined
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/^\[ant-only\]\s+/, '')
    .replace(/\s*\(deferred\)\s*$/, '')
  const mapped = CLAUDE_CATEGORY_IDS[normalized]
  if (mapped !== undefined) return mapped
  if (normalized.includes('mcp')) return 'mcpTools'
  if (/\btools?\b/.test(normalized)) return 'toolDefinitions'
  return undefined
}

function assignUnaccountedTools(
  tokensById: Map<ContextUsageCategoryId, number>,
  used: number | null,
): void {
  if (used === null || used <= 0 || tokensById.size === 0) return
  if (tokensById.has('toolDefinitions')) return
  let accounted = 0
  for (const tokens of tokensById.values()) accounted += tokens
  const remainder = used - accounted
  if (remainder <= 0) return
  // Claude counts tool schemas via count_tokens(tools=...). Compatible
  // endpoints often fail that call, omit the System tools row, but still
  // report used from the last request's input_tokens which includes them.
  tokensById.set('toolDefinitions', remainder)
}

function assignFallback(
  tokensById: Map<ContextUsageCategoryId, number>,
  id: ContextUsageCategoryId,
  raw: unknown,
): void {
  if (tokensById.has(id)) return
  const total = sumDetailTokens(raw)
  if (total === undefined) return
  tokensById.set(id, total)
}

function sumDetailTokens(raw: unknown): number | undefined {
  if (!Array.isArray(raw)) return undefined
  let total = 0
  let found = false
  for (const item of raw) {
    const row = asRecord(item)
    if (row === undefined) continue
    const tokens = numberField(row, 'tokens')
    if (tokens === undefined) continue
    found = true
    total += tokens
  }
  return found ? total : undefined
}

export function mapPiContextUsage(usage: PiContextUsageSource | undefined): ContextUsage {
  if (usage === undefined) return emptyContextUsage()
  return {
    used: usage.tokens,
    limit: usage.contextWindow > 0 ? usage.contextWindow : null,
    categories: CONTEXT_USAGE_CATEGORY_IDS.map((id) => ({ id, tokens: null })),
  }
}
