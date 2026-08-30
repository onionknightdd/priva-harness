export const CONTEXT_USAGE_CATEGORY_IDS = [
  "systemPrompt",
  "toolDefinitions",
  "rules",
  "skills",
  "mcpTools",
  "subagentDefinitions",
  "conversation",
] as const

export type ContextUsageCategoryId = (typeof CONTEXT_USAGE_CATEGORY_IDS)[number]

export type ContextUsageCategory = {
  readonly id: ContextUsageCategoryId
  readonly tokens: number | null
}

export type ContextUsage = {
  readonly used: number | null
  readonly limit: number | null
  readonly categories: readonly ContextUsageCategory[]
}

export type ContextUsageTone = "empty" | "normal" | "warn" | "crit"

export const CONTEXT_USAGE_CATEGORY_SWATCH: Record<
  ContextUsageCategoryId,
  string
> = {
  systemPrompt: "bg-context-system",
  toolDefinitions: "bg-context-tools",
  rules: "bg-context-rules",
  skills: "bg-context-skills",
  mcpTools: "bg-context-mcp",
  subagentDefinitions: "bg-context-subagent",
  conversation: "bg-context-conversation",
}

export function emptyContextUsage(): ContextUsage {
  return {
    used: null,
    limit: null,
    categories: CONTEXT_USAGE_CATEGORY_IDS.map((id) => ({
      id,
      tokens: null,
    })),
  }
}

export function contextUsagePercent(usage: ContextUsage): number | null {
  if (usage.used === null || usage.limit === null || usage.limit <= 0) {
    return null
  }

  return Math.round((usage.used / usage.limit) * 100)
}

export function contextUsageTone(percent: number | null): ContextUsageTone {
  if (percent === null) {
    return "empty"
  }

  if (percent >= 90) {
    return "crit"
  }

  if (percent >= 70) {
    return "warn"
  }

  return "normal"
}

export function formatTokenCount(tokens: number): string {
  const absolute = Math.abs(tokens)

  if (absolute < 1000) {
    return String(Math.round(tokens))
  }

  if (absolute < 1_000_000) {
    return `${trimTokenUnit(tokens / 1000)}K`
  }

  return `${trimTokenUnit(tokens / 1_000_000)}M`
}

export function contextUsageSegments(usage: ContextUsage): Array<{
  id: ContextUsageCategoryId
  fraction: number
}> {
  const limit = usage.limit

  if (limit === null || limit <= 0) {
    return []
  }

  return usage.categories.flatMap((category) => {
    if (category.tokens === null || category.tokens <= 0) {
      return []
    }

    return [{ id: category.id, fraction: category.tokens / limit }]
  })
}

function trimTokenUnit(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
