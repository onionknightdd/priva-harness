import type { RunFailureCode } from '../event/agent-event.js'
import { daysBetween, localDate, localDateParts, shiftDate } from './local-time.js'
import {
  USAGE_RANGE_DAYS,
  type TokenTotals,
  type UsageDailyModels,
  type UsageDay,
  type UsageFailure,
  type UsageModel,
  type UsageOverview,
  type UsageOverviewInput,
  type UsageOverviewRows,
  type UsageRangeCounts,
  type UsageSkill,
  type UsageTool,
} from './usage-overview.js'

const TOP_TOOLS = 10
const TOP_SKILLS = 5

interface MutableTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number | null
  runsWithoutCost: number
}

function emptyTotals(): MutableTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, runsWithoutCost: 0 }
}

function addTokens(
  totals: MutableTotals,
  row: { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; costUsd: number | null },
): void {
  totals.inputTokens += row.inputTokens ?? 0
  totals.outputTokens += row.outputTokens ?? 0
  totals.cacheReadTokens += row.cacheReadTokens ?? 0
  totals.cacheWriteTokens += row.cacheWriteTokens ?? 0
  if (row.costUsd === null) totals.runsWithoutCost += 1
  else totals.costUsd = (totals.costUsd ?? 0) + row.costUsd
}

function processed(totals: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
  return totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens + totals.outputTokens
}

function finishTotals(totals: MutableTotals): TokenTotals {
  return { ...totals, processedTokens: processed(totals) }
}

// Pure: rows in, overview out. The SQL layer only has to fetch rows newer
// than the widest window; all calendar logic lives here so it is testable
// without a database.
export function buildUsageOverview(
  rows: UsageOverviewRows,
  input: UsageOverviewInput,
  retentionDays: number,
): UsageOverview {
  const now = input.now ?? new Date()
  const tz = input.timeZone
  const today = localDate(now, tz)
  const widest = Math.max(...USAGE_RANGE_DAYS)
  const rangeStart = (days: number): string => shiftDate(today, -(days - 1))
  const inWindow = (date: string, days: number): boolean => date >= rangeStart(days) && date <= today

  // --- runs: per local day, per range -------------------------------------
  const dayRuns = new Map<string, { runs: number; totals: MutableTotals }>()
  const hourCounts = new Array<number>(24).fill(0)
  const durations: number[] = []
  const failures = new Map<RunFailureCode, number>()
  const ranges = USAGE_RANGE_DAYS.map((days) => ({
    days,
    runs: 0, completed: 0, failed: 0, aborted: 0,
    sessions: new Set<string>(), activeDays: new Set<string>(),
    totals: emptyTotals(),
  }))

  for (const run of rows.runs) {
    const { date, hour } = localDateParts(new Date(run.startedUtc), tz)
    if (!inWindow(date, widest)) continue
    const day = dayRuns.get(date) ?? { runs: 0, totals: emptyTotals() }
    day.runs += 1
    addTokens(day.totals, run)
    dayRuns.set(date, day)
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1
    if (run.outcome === 'completed' && run.durationMs !== null) durations.push(run.durationMs)
    if (run.outcome === 'failed') failures.set(run.failureCode ?? 'unknown', (failures.get(run.failureCode ?? 'unknown') ?? 0) + 1)
    for (const range of ranges) {
      if (!inWindow(date, range.days)) continue
      range.runs += 1
      if (run.outcome === 'completed') range.completed += 1
      else if (run.outcome === 'failed') range.failed += 1
      else if (run.outcome === 'aborted') range.aborted += 1
      if (run.sessionId !== null) range.sessions.add(run.sessionId)
      range.activeDays.add(date)
      addTokens(range.totals, run)
    }
  }

  // --- heatmap over the requested days, streaks over the widest window ----
  const heatmap: UsageDay[] = []
  for (let offset = input.heatmapDays - 1; offset >= 0; offset -= 1) {
    const date = shiftDate(today, -offset)
    const day = dayRuns.get(date)
    heatmap.push({ date, runs: day?.runs ?? 0, processedTokens: day === undefined ? 0 : processed(day.totals) })
  }
  const activeDates = [...dayRuns.keys()].sort()
  const { current, longest } = streaks(activeDates, today)

  // --- models --------------------------------------------------------------
  const modelTotals = new Map<string, { runs: number; totals: MutableTotals }>()
  const dailyModels = new Map<string, Record<string, number>>()
  for (const row of rows.models) {
    const date = localDate(new Date(row.startedUtc), tz)
    if (!inWindow(date, widest)) continue
    const entry = modelTotals.get(row.model) ?? { runs: 0, totals: emptyTotals() }
    entry.runs += 1
    addTokens(entry.totals, row)
    modelTotals.set(row.model, entry)
    if (inWindow(date, input.heatmapDays)) {
      const byModel = dailyModels.get(date) ?? {}
      byModel[row.model] = (byModel[row.model] ?? 0) + processed({
        inputTokens: row.inputTokens, outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens ?? 0, cacheWriteTokens: row.cacheWriteTokens ?? 0,
      })
      dailyModels.set(date, byModel)
    }
  }
  const allModelTokens = [...modelTotals.values()].reduce((sum, entry) => sum + processed(entry.totals), 0)
  const models: UsageModel[] = [...modelTotals.entries()]
    .map(([model, entry]) => ({
      model, runs: entry.runs, ...finishTotals(entry.totals),
      share: allModelTokens === 0 ? 0 : processed(entry.totals) / allModelTokens,
    }))
    .sort((left, right) => right.processedTokens - left.processedTokens || left.model.localeCompare(right.model))

  // --- tools ---------------------------------------------------------------
  const toolTotals = new Map<string, { mcpServer: string | null; calls: number; errors: number; durationSum: number; durationCount: number }>()
  for (const tool of rows.tools) {
    if (!inWindow(localDate(new Date(tool.tsUtc), tz), widest)) continue
    const key = tool.toolName.toLowerCase()
    const entry = toolTotals.get(key) ?? { mcpServer: tool.mcpServer, calls: 0, errors: 0, durationSum: 0, durationCount: 0 }
    entry.calls += 1
    if (!tool.ok) entry.errors += 1
    if (tool.durationMs !== null) {
      entry.durationSum += tool.durationMs
      entry.durationCount += 1
    }
    toolTotals.set(key, entry)
  }
  const tools: UsageTool[] = [...toolTotals.entries()]
    .map(([tool, entry]) => ({
      tool, mcpServer: entry.mcpServer, calls: entry.calls, errors: entry.errors,
      avgDurationMs: entry.durationCount === 0 ? null : Math.round(entry.durationSum / entry.durationCount),
    }))
    .sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool))
    .slice(0, TOP_TOOLS)

  // --- audits: skills, permissions, compactions ----------------------------
  const skillCounts = new Map<string, number>()
  let asked = 0
  let denied = 0
  let timedOut = 0
  let compactions = 0
  for (const audit of rows.audits) {
    if (!inWindow(localDate(new Date(audit.tsUtc), tz), widest)) continue
    switch (audit.action) {
      case 'skill.invoked':
        if (audit.target !== null) skillCounts.set(audit.target, (skillCounts.get(audit.target) ?? 0) + 1)
        break
      case 'permission.resolved':
        asked += 1
        if (audit.decision === 'deny') denied += 1
        if (audit.reason === 'timeout') timedOut += 1
        break
      case 'session.compacted':
        compactions += 1
        break
      default:
    }
  }
  const skills: UsageSkill[] = [...skillCounts.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((left, right) => right.count - left.count || left.skill.localeCompare(right.skill))
    .slice(0, TOP_SKILLS)

  const failureList: UsageFailure[] = [...failures.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))

  durations.sort((left, right) => left - right)
  const peak = hourCounts.reduce((best, count, hour) => (count > (hourCounts[best] ?? 0) ? hour : best), 0)

  return {
    timeZone: tz,
    generatedAt: now.toISOString(),
    today,
    retentionDays,
    ranges: ranges.map((range): UsageRangeCounts => ({
      days: range.days,
      runs: range.runs, completed: range.completed, failed: range.failed, aborted: range.aborted,
      activeSessions: range.sessions.size, activeDays: range.activeDays.size,
      ...finishTotals(range.totals),
    })),
    heatmap,
    currentStreak: current,
    longestStreak: longest,
    peakHour: rows.runs.length === 0 || (hourCounts[peak] ?? 0) === 0 ? null : peak,
    models,
    dailyModels: [...dailyModels.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([date, byModel]): UsageDailyModels => ({ date, byModel })),
    failures: failureList,
    durationP50Ms: percentile(durations, 0.5),
    durationP95Ms: percentile(durations, 0.95),
    tools,
    skills,
    permissions: { asked, denied, timedOut },
    compactions,
  }
}

function streaks(activeDates: readonly string[], today: string): { current: number; longest: number } {
  if (activeDates.length === 0) return { current: 0, longest: 0 }
  let longest = 1
  let run = 1
  for (let index = 1; index < activeDates.length; index += 1) {
    if (daysBetween(activeDates[index - 1] ?? '', activeDates[index] ?? '') === 1) {
      run += 1
      longest = Math.max(longest, run)
    } else {
      run = 1
    }
  }
  const active = new Set(activeDates)
  const yesterday = shiftDate(today, -1)
  if (!active.has(today) && !active.has(yesterday)) return { current: 0, longest }
  let current = 0
  let cursor = active.has(today) ? today : yesterday
  while (active.has(cursor)) {
    current += 1
    cursor = shiftDate(cursor, -1)
  }
  return { current, longest }
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index] ?? null
}
