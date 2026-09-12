import type { Activity } from "@/components/heatmap/calendar-heatmap"

const USAGE_API_PREFIX = "/api/sandbox/usage"

// Mirrors services/agent-runner/ts/src/core/resource/usage-overview.ts. Every
// number is derived server-side in the caller's time zone; the client only
// formats and arranges it.
export type UsageRangeDays = 7 | 30 | 365

export type TokenTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  processedTokens: number
  costUsd: number | null
  runsWithoutCost: number
}

export type UsageRangeCounts = TokenTotals & {
  days: UsageRangeDays
  runs: number
  completed: number
  failed: number
  aborted: number
  activeSessions: number
  activeDays: number
}

export type UsageDay = {
  date: string
  runs: number
  processedTokens: number
}

export type UsageModel = TokenTotals & {
  model: string
  runs: number
  share: number
}

export type UsageDailyModels = {
  date: string
  byModel: Record<string, number>
}

export type UsageFailure = {
  code: string
  count: number
}

export type UsageTool = {
  tool: string
  mcpServer: string | null
  calls: number
  errors: number
  avgDurationMs: number | null
}

export type UsageSkill = {
  skill: string
  count: number
}

export type UsageOverview = {
  timeZone: string
  generatedAt: string
  today: string
  retentionDays: number
  ranges: UsageRangeCounts[]
  heatmap: UsageDay[]
  currentStreak: number
  longestStreak: number
  peakHour: number | null
  models: UsageModel[]
  dailyModels: UsageDailyModels[]
  failures: UsageFailure[]
  durationP50Ms: number | null
  durationP95Ms: number | null
  tools: UsageTool[]
  skills: UsageSkill[]
  permissions: { asked: number; denied: number; timedOut: number }
  compactions: number
}

export type UsageOverviewQuery = {
  timeZone: string
  days: number
}

export class UsageApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "UsageApiError"
    this.status = status
  }
}

// The server folds UTC facts into calendar days for whichever zone the
// browser reports, so the same database renders correctly when viewed from
// another location.
export function browserTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone && zone.length > 0 ? zone : "UTC"
}

export function usageOverviewUrl(query: UsageOverviewQuery) {
  const params = new URLSearchParams({
    tz: query.timeZone,
    days: String(query.days),
  })
  return `${USAGE_API_PREFIX}/overview?${params.toString()}`
}

export async function fetchUsageOverview(
  query: UsageOverviewQuery,
  init?: RequestInit
): Promise<UsageOverview> {
  const response = await fetch(usageOverviewUrl(query), { cache: "no-store", ...init })

  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      // Keep the HTTP status text when the response has no JSON body.
    }
    throw new UsageApiError(response.status, detail)
  }

  return (await response.json()) as UsageOverview
}

// Heatmap cells carry the tokens the models processed that day; zero renders
// as an empty cell, so the grid itself is the "no activity yet" state.
export function heatmapActivities(days: readonly UsageDay[]): Activity[] {
  return days.map((day) => ({ date: day.date, value: day.processedTokens }))
}
