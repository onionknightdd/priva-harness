import { describe, expect, it } from 'vitest'

import { buildUsageOverview } from '../../../../src/core/resource/usage-overview-builder.js'
import type { RunFactRow, UsageOverviewRows } from '../../../../src/core/resource/usage-overview.js'

// 2026-09-12 08:00 in Shanghai == 2026-09-12T00:00Z
const NOW = new Date('2026-09-12T00:00:00.000Z')
const TZ = 'Asia/Shanghai'

function run(startedUtc: string, overrides: Partial<RunFactRow> = {}): RunFactRow {
  return {
    startedUtc, sessionId: 's1', cwd: '/work/demo', outcome: 'completed', failureCode: null, durationMs: 1000, model: 'sonnet',
    inputTokens: 10, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 40, costUsd: 0.01,
    ...overrides,
  }
}

const empty: UsageOverviewRows = { runs: [], models: [], tools: [], audits: [] }

describe('buildUsageOverview', () => {
  it('buckets runs into the caller\'s local days and windows', () => {
    const rows: UsageOverviewRows = {
      ...empty,
      runs: [
        // 2026-09-11 23:30 Shanghai (still the 11th locally, the 11th in UTC too)
        run('2026-09-11T15:30:00.000Z'),
        // 2026-09-12 00:30 Shanghai: the 12th locally although UTC says the 11th
        run('2026-09-11T16:30:00.000Z', { sessionId: 's2' }),
        // 8 days ago: outside 7d, inside 30d
        run('2026-09-03T12:00:00.000Z', { sessionId: 's3', outcome: 'failed', failureCode: 'api_error', costUsd: null }),
        // 40 days ago: outside 30d, inside 365d
        run('2026-08-02T12:00:00.000Z', { outcome: 'aborted', inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null }),
        // beyond 365d: ignored everywhere
        run('2025-01-01T12:00:00.000Z'),
      ],
    }
    const overview = buildUsageOverview(rows, { timeZone: TZ, heatmapDays: 3, now: NOW }, 365)

    expect(overview.today).toBe('2026-09-12')
    expect(overview.retentionDays).toBe(365)
    const [d7, d30, d365] = overview.ranges
    expect(d7).toMatchObject({
      days: 7, runs: 2, completed: 2, failed: 0, aborted: 0, activeSessions: 2, activeDays: 2,
      inputTokens: 20, outputTokens: 40, cacheReadTokens: 600, cacheWriteTokens: 80, processedTokens: 740,
      costUsd: 0.02, runsWithoutCost: 0,
    })
    expect(d30).toMatchObject({ days: 30, runs: 3, failed: 1, activeSessions: 3, activeDays: 3, processedTokens: 1110, runsWithoutCost: 1 })
    expect(d365).toMatchObject({ days: 365, runs: 4, aborted: 1, activeDays: 4, processedTokens: 1110, runsWithoutCost: 2 })
    expect(d365?.costUsd).toBeCloseTo(0.02, 6)

    expect(overview.heatmap).toEqual([
      { date: '2026-09-10', runs: 0, processedTokens: 0 },
      { date: '2026-09-11', runs: 1, processedTokens: 370 },
      { date: '2026-09-12', runs: 1, processedTokens: 370 },
    ])
    expect(overview.currentStreak).toBe(2)
    expect(overview.longestStreak).toBe(2)
    expect(overview.peakHour).toBe(20) // 12:00Z is 20:00 in Shanghai, two runs
    expect(overview.failures).toEqual([{ code: 'api_error', count: 1 }])
    expect(overview.durationP50Ms).toBe(1000)
    expect(overview.durationP95Ms).toBe(1000)
  })

  it('reports cost as null when no run in the window knew its price', () => {
    const overview = buildUsageOverview(
      { ...empty, runs: [run('2026-09-12T00:00:00.000Z', { costUsd: null })] },
      { timeZone: TZ, heatmapDays: 1, now: NOW }, 365,
    )
    expect(overview.ranges[0]).toMatchObject({ costUsd: null, runsWithoutCost: 1, processedTokens: 370 })
  })

  it('computes streaks that end yesterday and percentiles over completed durations', () => {
    const runs = [
      run('2026-09-11T02:00:00.000Z', { durationMs: 100 }),
      run('2026-09-10T02:00:00.000Z', { durationMs: 200 }),
      run('2026-09-09T02:00:00.000Z', { durationMs: 300 }),
      run('2026-09-05T02:00:00.000Z', { durationMs: 9000 }),
      run('2026-09-04T02:00:00.000Z', { durationMs: 9000, outcome: 'failed' }),
    ]
    const overview = buildUsageOverview({ ...empty, runs }, { timeZone: TZ, heatmapDays: 1, now: NOW }, 365)
    expect(overview.currentStreak).toBe(3)
    expect(overview.longestStreak).toBe(3)
    expect(overview.durationP50Ms).toBe(200)
    expect(overview.durationP95Ms).toBe(9000)
  })

  it('aggregates models with shares, daily model series, tools, skills, permissions and compactions', () => {
    const rows: UsageOverviewRows = {
      runs: [run('2026-09-12T00:00:00.000Z')],
      models: [
        { startedUtc: '2026-09-12T00:00:00.000Z', model: 'sonnet', inputTokens: 0, outputTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100, costUsd: 0.03 },
        { startedUtc: '2026-09-11T00:00:00.000Z', model: 'sonnet', inputTokens: 0, outputTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100, costUsd: null },
        { startedUtc: '2026-09-12T00:00:00.000Z', model: 'haiku', inputTokens: 50, outputTokens: 50, cacheReadTokens: null, cacheWriteTokens: null, costUsd: 0.001 },
      ],
      tools: [
        { tsUtc: '2026-09-12T00:00:00.000Z', toolName: 'Read', mcpServer: null, ok: true, durationMs: 10 },
        { tsUtc: '2026-09-12T00:00:00.000Z', toolName: 'read', mcpServer: null, ok: false, durationMs: 30 },
        { tsUtc: '2026-09-12T00:00:00.000Z', toolName: 'mcp__github__search', mcpServer: 'github', ok: true, durationMs: null },
        { tsUtc: '2025-01-01T00:00:00.000Z', toolName: 'Bash', mcpServer: null, ok: true, durationMs: 5 },
      ],
      audits: [
        { tsUtc: '2026-09-12T00:00:00.000Z', action: 'skill.invoked', target: 'pdf', decision: null, reason: null },
        { tsUtc: '2026-09-12T00:00:00.000Z', action: 'skill.invoked', target: 'pdf', decision: null, reason: null },
        { tsUtc: '2026-09-12T00:00:00.000Z', action: 'skill.invoked', target: 'xlsx', decision: null, reason: null },
        { tsUtc: '2026-09-12T00:00:00.000Z', action: 'permission.resolved', target: 'Bash', decision: 'allow', reason: 'answered' },
        { tsUtc: '2026-09-12T00:00:00.000Z', action: 'permission.resolved', target: 'Bash', decision: 'deny', reason: 'timeout' },
        { tsUtc: '2026-09-12T00:00:00.000Z', action: 'session.compacted', target: null, decision: null, reason: null },
        { tsUtc: '2025-01-01T00:00:00.000Z', action: 'session.compacted', target: null, decision: null, reason: null },
      ],
    }
    const overview = buildUsageOverview(rows, { timeZone: TZ, heatmapDays: 2, now: NOW }, 365)

    expect(overview.models).toEqual([
      expect.objectContaining({ model: 'sonnet', runs: 2, processedTokens: 2000, costUsd: 0.03, runsWithoutCost: 1, share: 2000 / 2100 }),
      expect.objectContaining({ model: 'haiku', runs: 1, processedTokens: 100, costUsd: 0.001, share: 100 / 2100 }),
    ])
    expect(overview.dailyModels).toEqual([
      { date: '2026-09-11', byModel: { sonnet: 1000 } },
      { date: '2026-09-12', byModel: { sonnet: 1000, haiku: 100 } },
    ])
    expect(overview.tools).toEqual([
      { tool: 'read', mcpServer: null, calls: 2, errors: 1, avgDurationMs: 20 },
      { tool: 'mcp__github__search', mcpServer: 'github', calls: 1, errors: 0, avgDurationMs: null },
    ])
    expect(overview.skills).toEqual([{ skill: 'pdf', count: 2 }, { skill: 'xlsx', count: 1 }])
    expect(overview.permissions).toEqual({ asked: 2, denied: 1, timedOut: 1 })
    expect(overview.compactions).toBe(1)
  })

  it('returns an empty but well-formed overview without data', () => {
    const overview = buildUsageOverview(empty, { timeZone: 'UTC', heatmapDays: 7, now: NOW }, 365)
    expect(overview.heatmap).toHaveLength(7)
    expect(overview.ranges.map((range) => range.runs)).toEqual([0, 0, 0])
    expect(overview.peakHour).toBeNull()
    expect(overview.durationP50Ms).toBeNull()
    expect(overview.currentStreak).toBe(0)
    expect(overview.models).toEqual([])
  })
})
