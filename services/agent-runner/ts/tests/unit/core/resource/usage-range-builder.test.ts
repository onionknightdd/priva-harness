import { describe, expect, it } from 'vitest'

import { buildUsageRange } from '../../../../src/core/resource/usage-range-builder.js'
import type { RunFactRow } from '../../../../src/core/resource/usage-overview.js'

const TZ = 'Asia/Shanghai'

function run(startedUtc: string, overrides: Partial<RunFactRow> = {}): RunFactRow {
  return {
    startedUtc, sessionId: 's1', cwd: '/work/a', outcome: 'completed', failureCode: null, durationMs: 1000, model: 'sonnet',
    inputTokens: 10, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 40, costUsd: 0.01,
    ...overrides,
  }
}

describe('buildUsageRange', () => {
  it('folds runs into the caller\'s local days and keeps only the inclusive range', () => {
    const summary = buildUsageRange([
      // 2026-09-01 00:30 Shanghai: inside although UTC still says August 31st
      run('2026-08-31T16:30:00.000Z'),
      // 2026-08-31 23:30 Shanghai: the day before the range starts
      run('2026-08-31T15:30:00.000Z', { sessionId: 's0', cwd: '/work/z' }),
      // 2026-09-12 23:59 Shanghai: last day of the range
      run('2026-09-12T15:59:00.000Z', { sessionId: 's2', cwd: '/work/b', outcome: 'failed', failureCode: 'api_error', costUsd: null }),
      // 2026-09-13 00:01 Shanghai: after the range
      run('2026-09-12T16:01:00.000Z', { sessionId: 's3' }),
    ], { timeZone: TZ, from: '2026-09-01', to: '2026-09-12' })

    expect(summary).toMatchObject({
      from: '2026-09-01', to: '2026-09-12', days: 12,
      runs: 2, completed: 1, failed: 1, aborted: 0,
      activeSessions: 2, activeDays: 2, projects: 2,
      inputTokens: 20, outputTokens: 40, cacheReadTokens: 600, cacheWriteTokens: 80, processedTokens: 740,
      costUsd: 0.01, runsWithoutCost: 1,
    })
  })

  it('reports the peak day, earliest on a tie, and the longest streak with its dates', () => {
    const summary = buildUsageRange([
      run('2026-09-01T02:00:00.000Z'),
      run('2026-09-02T02:00:00.000Z'),
      run('2026-09-03T02:00:00.000Z', { inputTokens: 1000 }),
      run('2026-09-03T03:00:00.000Z'),
      // gap on the 4th
      run('2026-09-05T02:00:00.000Z', { inputTokens: 1000, cacheReadTokens: 670 }),
      run('2026-09-06T02:00:00.000Z'),
    ], { timeZone: TZ, from: '2026-09-01', to: '2026-09-10' })

    // 3rd: 1360 + 370 = 1730; 5th: 1000 + 20 + 670 + 40 = 1730 -> tie, earliest wins
    expect(summary.peakDay).toEqual({ date: '2026-09-03', processedTokens: 1730 })
    expect(summary.longestStreak).toEqual({ days: 3, from: '2026-09-01', to: '2026-09-03' })
    expect(summary.activeDays).toBe(5)
  })

  it('does not count runs recorded before cwd existed as projects', () => {
    const summary = buildUsageRange([
      run('2026-09-01T02:00:00.000Z', { cwd: null }),
      run('2026-09-01T03:00:00.000Z', { cwd: null }),
    ], { timeZone: TZ, from: '2026-09-01', to: '2026-09-01' })
    expect(summary.runs).toBe(2)
    expect(summary.projects).toBe(0)
  })

  it('returns zeros and nulls for an empty range', () => {
    const summary = buildUsageRange([], { timeZone: TZ, from: '2026-09-01', to: '2026-09-07' })
    expect(summary).toMatchObject({
      days: 7, runs: 0, activeSessions: 0, activeDays: 0, projects: 0, processedTokens: 0,
      costUsd: null, runsWithoutCost: 0, peakDay: null, longestStreak: null,
    })
  })
})
