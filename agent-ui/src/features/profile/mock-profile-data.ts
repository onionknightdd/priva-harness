import { eachDayOfInterval, formatISO, subWeeks } from "date-fns"

export const PROFILE_RANGE_WEEKS = [4, 8, 12] as const

export type ProfileRangeWeeks = (typeof PROFILE_RANGE_WEEKS)[number]

export const mockProfilePlan = {
  usagePercent: 78,
  usageUsed: "12.48M",
  usageLimit: "16M",
  projects: 47,
  agents: 18,
  sessions: 892,
} as const

export const mockProfileKpis = {
  totalTokens: "12.48M",
  totalTokensTrend: "+18.6%",
  dailyAverage: "416.2K",
  dailyAverageTrend: "+12.4%",
  peakDayValue: "1.32M",
  totalRequests: "8,732",
  totalRequestsTrend: "+9.8%",
} as const

export const mockTopModels = [
  { id: "gpt4o", share: 38.4, fill: "var(--color-gpt4o)" },
  { id: "claude", share: 27.1, fill: "var(--color-claude)" },
  { id: "gemini", share: 18.6, fill: "var(--color-gemini)" },
  { id: "other", share: 15.9, fill: "var(--color-other)" },
] as const

export const mockUseCases = [
  { id: "codeGeneration", percent: 42.1 },
  { id: "codeReview", percent: 28.4 },
  { id: "debugging", percent: 16.2 },
  { id: "docs", percent: 8.7 },
  { id: "other", percent: 4.6 },
] as const

export const mockRecentActivity: Array<{
  id: "api-client" | "review-diff" | "fix-types" | "write-docs" | "scaffold-ui"
  tokens: string
  minutesAgo?: number
  hoursAgo?: number
}> = [
  { id: "api-client", minutesAgo: 2, tokens: "2.4K" },
  { id: "review-diff", minutesAgo: 18, tokens: "1.1K" },
  { id: "fix-types", hoursAgo: 1, tokens: "860" },
  { id: "write-docs", hoursAgo: 3, tokens: "1.6K" },
  { id: "scaffold-ui", hoursAgo: 6, tokens: "3.2K" },
]

export type HeatmapDay = {
  date: string
  value: number
}

function hashDate(date: string) {
  let hash = 0

  for (const character of date) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }

  return hash
}

function tokensForDate(date: string) {
  const hash = hashDate(date)
  const weekday = new Date(`${date}T00:00:00`).getDay()
  const isWeekend = weekday === 0 || weekday === 6

  if (hash % 8 === 0) {
    return 0
  }

  const base = isWeekend ? 42_000 : 210_000
  return base + (hash % (isWeekend ? 180_000 : 620_000))
}

export function createMockHeatmapData(weeks: ProfileRangeWeeks): HeatmapDay[] {
  const end = new Date()
  const start = subWeeks(end, weeks)
  const days = eachDayOfInterval({ start, end }).map((day) => {
    const date = formatISO(day, { representation: "date" })
    return { date, value: tokensForDate(date) }
  })

  if (days.length === 0) {
    return days
  }

  const peakIndex = Math.max(0, days.length - 14)
  const peakDay = days[peakIndex]

  if (peakDay) {
    peakDay.value = 1_320_000
  }

  return days
}

export function getHeatmapPeak(days: HeatmapDay[]) {
  return days.reduce(
    (peak, day) => (day.value > peak.value ? day : peak),
    days[0] ?? { date: "", value: 0 }
  )
}
