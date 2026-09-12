import { daysBetween, localDate } from './local-time.js'
import { addTokens, emptyTotals, finishTotals, processed, type MutableTotals } from './usage-overview-builder.js'
import type { RunFactRow, UsageRangeInput, UsageRangeSummary, UsageStreak } from './usage-overview.js'

// Pure: finished run rows in, one summary for an inclusive local date range
// out. The SQL layer fetches rows with a day of slack on both sides; the
// exact fold into the caller's calendar happens here.
export function buildUsageRange(rows: readonly RunFactRow[], input: UsageRangeInput): UsageRangeSummary {
  const totals = emptyTotals()
  const days = new Map<string, MutableTotals>()
  const sessions = new Set<string>()
  const projects = new Set<string>()
  let runs = 0
  let completed = 0
  let failed = 0
  let aborted = 0

  for (const run of rows) {
    const date = localDate(new Date(run.startedUtc), input.timeZone)
    if (date < input.from || date > input.to) continue
    runs += 1
    if (run.outcome === 'completed') completed += 1
    else if (run.outcome === 'failed') failed += 1
    else if (run.outcome === 'aborted') aborted += 1
    if (run.sessionId !== null) sessions.add(run.sessionId)
    if (run.cwd !== null) projects.add(run.cwd)
    addTokens(totals, run)
    const day = days.get(date) ?? emptyTotals()
    addTokens(day, run)
    days.set(date, day)
  }

  let peakDay: UsageRangeSummary['peakDay'] = null
  for (const [date, dayTotals] of days) {
    const processedTokens = processed(dayTotals)
    if (peakDay === null || processedTokens > peakDay.processedTokens || (processedTokens === peakDay.processedTokens && date < peakDay.date)) {
      peakDay = { date, processedTokens }
    }
  }

  return {
    from: input.from,
    to: input.to,
    days: daysBetween(input.from, input.to) + 1,
    runs, completed, failed, aborted,
    activeSessions: sessions.size,
    activeDays: days.size,
    projects: projects.size,
    peakDay,
    longestStreak: longestStreak([...days.keys()].sort()),
    ...finishTotals(totals),
  }
}

function longestStreak(activeDates: readonly string[]): UsageStreak | null {
  let best: UsageStreak | null = null
  let start = 0
  for (let index = 0; index <= activeDates.length; index += 1) {
    const previous = activeDates[index - 1]
    const current = activeDates[index]
    const continues = previous !== undefined && current !== undefined && daysBetween(previous, current) === 1
    if (continues) continue
    if (previous !== undefined) {
      const from = activeDates[start] ?? previous
      const days = index - start
      if (best === null || days > best.days) best = { days, from, to: previous }
    }
    start = index
  }
  return best
}
