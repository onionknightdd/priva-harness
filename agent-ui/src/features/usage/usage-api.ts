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

// --- arbitrary local date range for the overview cards ---------------------

export type UsagePeakDay = { date: string; processedTokens: number }
export type UsageStreak = { days: number; from: string; to: string }

export type UsageRangeSummary = TokenTotals & {
  from: string
  to: string
  days: number
  runs: number
  completed: number
  failed: number
  aborted: number
  activeSessions: number
  activeDays: number
  projects: number
  peakDay: UsagePeakDay | null
  longestStreak: UsageStreak | null
}

export type LocalDateRange = { from: string; to: string }

export type UsageRangeQuery = LocalDateRange & { timeZone: string }

export const RANGE_PRESETS = [7, 30, 365] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

// Presets end today and cover exactly `days` local days, so "7 天" is today
// plus the six days before it.
export function presetRange(days: RangePreset, today: string): LocalDateRange {
  return { from: shiftLocalDate(today, -(days - 1)), to: today }
}

export function matchingPreset(range: LocalDateRange, today: string): RangePreset | null {
  return RANGE_PRESETS.find((days) => {
    const preset = presetRange(days, today)
    return preset.from === range.from && preset.to === range.to
  }) ?? null
}

// Calendar arithmetic on YYYY-MM-DD strings without touching the browser zone.
export function shiftLocalDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10)
}

export function usageRangeUrl(query: UsageRangeQuery) {
  const params = new URLSearchParams({ tz: query.timeZone, from: query.from, to: query.to })
  return `${USAGE_API_PREFIX}/range?${params.toString()}`
}

export async function fetchUsageRange(
  query: UsageRangeQuery,
  init?: RequestInit
): Promise<UsageRangeSummary> {
  return requestJson<UsageRangeSummary>(usageRangeUrl(query), init)
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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })

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

  return (await response.json()) as T
}

export async function fetchUsageOverview(
  query: UsageOverviewQuery,
  init?: RequestInit
): Promise<UsageOverview> {
  return requestJson<UsageOverview>(usageOverviewUrl(query), init)
}

// Stacked model chart: one bar per calendar month, one series per model.
export const MODEL_SERIES_LIMIT = 5
export const OTHER_MODELS_KEY = "__other__"

export type ModelMonth = {
  // First day of the month, YYYY-MM-01, so callers can format it in any locale.
  month: string
  byModel: Record<string, number>
}

export type ModelSeries = {
  // Series keys in stacking order (largest share first), ending with the
  // aggregated "others" bucket when more than `limit` models were used.
  keys: string[]
  months: ModelMonth[]
}

// `window` is the full run of days the overview covers (the heatmap), so every
// month in range gets a bar even when no model was used in it.
export function modelSeries(
  window: readonly { date: string }[],
  days: readonly UsageDailyModels[],
  models: readonly UsageModel[],
  limit = MODEL_SERIES_LIMIT
): ModelSeries {
  const ranked = [...models]
    .sort((left, right) => right.processedTokens - left.processedTokens)
    .map((model) => model.model)
  const shown = ranked.slice(0, limit)
  const keys = ranked.length > limit ? [...shown, OTHER_MODELS_KEY] : shown
  const monthOf = (date: string) => `${date.slice(0, 7)}-01`
  const byMonth = new Map<string, Record<string, number>>()
  for (const day of window) {
    const month = monthOf(day.date)
    if (!byMonth.has(month)) byMonth.set(month, Object.fromEntries(keys.map((key) => [key, 0])))
  }
  for (const day of days) {
    const bucket = byMonth.get(monthOf(day.date))
    if (!bucket) continue
    for (const [model, tokens] of Object.entries(day.byModel)) {
      const key = shown.includes(model) ? model : OTHER_MODELS_KEY
      if (key in bucket) bucket[key] = (bucket[key] ?? 0) + tokens
    }
  }
  const months = [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, values]) => ({ month, byModel: values }))
  return { keys, months }
}

export type ModelRow = {
  key: string
  processedTokens: number
  share: number
  costUsd: number | null
  runsWithoutCost: number
  runs: number
}

// Top models by processed tokens; the tail is folded into one "others" row so
// the table matches the chart's series.
export function modelRows(models: readonly UsageModel[], limit = MODEL_SERIES_LIMIT): ModelRow[] {
  const ranked = [...models].sort((left, right) => right.processedTokens - left.processedTokens)
  const shown = ranked.slice(0, limit).map((model) => ({
    key: model.model, processedTokens: model.processedTokens, share: model.share,
    costUsd: model.costUsd, runsWithoutCost: model.runsWithoutCost, runs: model.runs,
  }))
  const rest = ranked.slice(limit)
  if (rest.length === 0) return shown
  const others = rest.reduce<ModelRow>((sum, model) => ({
    key: OTHER_MODELS_KEY,
    processedTokens: sum.processedTokens + model.processedTokens,
    share: sum.share + model.share,
    costUsd: model.costUsd === null ? sum.costUsd : (sum.costUsd ?? 0) + model.costUsd,
    runsWithoutCost: sum.runsWithoutCost + model.runsWithoutCost,
    runs: sum.runs + model.runs,
  }), { key: OTHER_MODELS_KEY, processedTokens: 0, share: 0, costUsd: null, runsWithoutCost: 0, runs: 0 })
  return [...shown, others]
}

export const HEATMAP_MODES = ["daily", "weekly", "cumulative"] as const
export type HeatmapMode = (typeof HEATMAP_MODES)[number]

// Monday-start week key so a whole column of the grid shares one value.
function weekKey(date: string) {
  const day = new Date(`${date}T00:00:00Z`)
  const offset = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - offset)
  return day.toISOString().slice(0, 10)
}

// Heatmap cells carry the tokens the models processed; zero renders as an
// empty cell, so the grid itself is the "no activity yet" state.
//   daily      - that day's processed tokens
//   weekly     - the Monday–Sunday total, repeated on each day of the week
//   cumulative - running total from the first day of the window
export function heatmapActivities(
  days: readonly UsageDay[],
  mode: HeatmapMode = "daily"
): Activity[] {
  if (mode === "weekly") {
    const totals = new Map<string, number>()
    for (const day of days) {
      const key = weekKey(day.date)
      totals.set(key, (totals.get(key) ?? 0) + day.processedTokens)
    }
    return days.map((day) => ({ date: day.date, value: totals.get(weekKey(day.date)) ?? 0 }))
  }
  if (mode === "cumulative") {
    let running = 0
    return days.map((day) => {
      running += day.processedTokens
      return { date: day.date, value: running }
    })
  }
  return days.map((day) => ({ date: day.date, value: day.processedTokens }))
}
