import type { RunFailureCode } from '../event/agent-event.js'
import type { RunOutcome } from './data-store.js'

// Read side of the usage store. Every number here is derived at query time
// from run_fact / run_model_usage / tool_fact / audit_event; nothing is
// materialised, and days are the caller's local days (see local-time.ts).

export const USAGE_RANGE_DAYS = [7, 30, 365] as const
export type UsageRangeDays = (typeof USAGE_RANGE_DAYS)[number]

export interface UsageOverviewInput {
  readonly timeZone: string
  // Days of heatmap / daily series to return, ending today (local).
  readonly heatmapDays: number
  readonly now?: Date
}

export interface TokenTotals {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  // input + cacheRead + cacheWrite + output: what the models actually processed.
  readonly processedTokens: number
  // Sum of the runs that reported a cost; null when none did.
  readonly costUsd: number | null
  // Runs whose cost is unknown, so the reader can flag a partial cost.
  readonly runsWithoutCost: number
}

export interface UsageRangeCounts extends TokenTotals {
  readonly days: UsageRangeDays
  readonly runs: number
  readonly completed: number
  readonly failed: number
  readonly aborted: number
  readonly activeSessions: number
  readonly activeDays: number
}

export interface UsageDay {
  readonly date: string
  readonly runs: number
  readonly processedTokens: number
}

export interface UsageModel extends TokenTotals {
  readonly model: string
  readonly runs: number
  // Share of processedTokens across all models in the window, 0..1.
  readonly share: number
}

export interface UsageDailyModels {
  readonly date: string
  readonly byModel: Readonly<Record<string, number>>
}

export interface UsageFailure {
  readonly code: RunFailureCode
  readonly count: number
}

export interface UsageTool {
  readonly tool: string
  readonly mcpServer: string | null
  readonly calls: number
  readonly errors: number
  readonly avgDurationMs: number | null
}

export interface UsageSkill {
  readonly skill: string
  readonly count: number
}

export interface UsageOverview {
  readonly timeZone: string
  readonly generatedAt: string
  readonly today: string
  readonly retentionDays: number
  readonly ranges: readonly UsageRangeCounts[]
  readonly heatmap: readonly UsageDay[]
  readonly currentStreak: number
  readonly longestStreak: number
  readonly peakHour: number | null
  readonly models: readonly UsageModel[]
  readonly dailyModels: readonly UsageDailyModels[]
  readonly failures: readonly UsageFailure[]
  readonly durationP50Ms: number | null
  readonly durationP95Ms: number | null
  readonly tools: readonly UsageTool[]
  readonly skills: readonly UsageSkill[]
  readonly permissions: { readonly asked: number; readonly denied: number; readonly timedOut: number }
  readonly compactions: number
}

// --- arbitrary local date range for the overview cards ---------------------

export interface UsageRangeInput {
  readonly timeZone: string
  // Inclusive local calendar days, YYYY-MM-DD.
  readonly from: string
  readonly to: string
}

export interface UsagePeakDay {
  readonly date: string
  readonly processedTokens: number
}

export interface UsageStreak {
  readonly days: number
  readonly from: string
  readonly to: string
}

export interface UsageRangeSummary extends TokenTotals {
  readonly from: string
  readonly to: string
  readonly days: number
  readonly runs: number
  readonly completed: number
  readonly failed: number
  readonly aborted: number
  readonly activeSessions: number
  readonly activeDays: number
  // Distinct working directories; runs recorded before cwd was stored are not counted.
  readonly projects: number
  readonly peakDay: UsagePeakDay | null
  // Longest run of consecutive active days inside the range.
  readonly longestStreak: UsageStreak | null
}

export interface AuditPageInput {
  readonly limit: number
  // Return rows with id strictly below this cursor (newest first).
  readonly before?: number
  readonly action?: string
  readonly sessionId?: string
}

export interface AuditEntry {
  readonly id: number
  readonly tsUtc: string
  readonly action: string
  readonly sessionId: string | null
  readonly runId: string | null
  readonly target: string | null
  readonly details: unknown
}

export interface AuditPage {
  readonly entries: readonly AuditEntry[]
  readonly nextBefore: number | null
}

// Raw rows the SQL layer hands to the overview builder.
export interface RunFactRow {
  readonly startedUtc: string
  readonly sessionId: string | null
  readonly cwd: string | null
  readonly outcome: RunOutcome
  readonly failureCode: RunFailureCode | null
  readonly durationMs: number | null
  readonly model: string
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly costUsd: number | null
}

export interface RunModelRow {
  readonly startedUtc: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly costUsd: number | null
}

export interface ToolFactRow {
  readonly tsUtc: string
  readonly toolName: string
  readonly mcpServer: string | null
  readonly ok: boolean
  readonly durationMs: number | null
}

export interface AuditCountRow {
  readonly tsUtc: string
  readonly action: string
  readonly target: string | null
  readonly decision: string | null
  readonly reason: string | null
}

export interface UsageOverviewRows {
  readonly runs: readonly RunFactRow[]
  readonly models: readonly RunModelRow[]
  readonly tools: readonly ToolFactRow[]
  readonly audits: readonly AuditCountRow[]
}
