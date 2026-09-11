import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  defaultDataRetention,
  type DataRecord,
  type RunFinishedRecord,
  type RunSource,
  type RunStartedRecord,
} from '../../../../src/core/resource/data-store.js'
import { SqliteDataStore } from '../../../../src/infrastructure/data/sqlite-data-store.js'
import { SCHEMA_VERSION } from '../../../../src/infrastructure/data/sqlite-schema.js'

const NOW = new Date('2026-09-12T00:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

function started(runId: string, tsUtc = NOW.toISOString()): RunStartedRecord {
  return {
    kind: 'run.started', tsUtc, runId, provider: 'pi', model: 'gpt-x', source: 'web',
    promptChars: 12, attachmentCount: 0, details: { text: 'hi' },
  }
}

function finished(runId: string, tsUtc = NOW.toISOString(), extra: Partial<RunFinishedRecord> = {}): RunFinishedRecord {
  return {
    kind: 'run.finished', tsUtc, runId, outcome: 'completed', durationMs: 1500,
    usage: { input: 10, output: 20, cacheRead: 1000, cacheWrite: 150 }, costUsd: 0.01, details: {}, ...extra,
  }
}

function tool(runId: string, toolUseId: string, toolName: string, tsUtc = NOW.toISOString()): DataRecord {
  return { kind: 'tool', tsUtc, runId, toolUseId, toolName, ok: true, durationMs: 40, details: { input: {} } }
}

describe('SqliteDataStore', () => {
  let dir: string
  let path: string
  let store: SqliteDataStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'priva-data-store-'))
    path = join(dir, '.data.db')
    store = SqliteDataStore.open(path)
  })

  afterEach(async () => {
    store.close()
    await rm(dir, { recursive: true, force: true })
  })

  function raw(): DatabaseSync {
    return new DatabaseSync(path, { readOnly: true })
  }

  function pragma(name: string): unknown {
    const db = raw()
    try {
      return Object.values(db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0]
    } finally {
      db.close()
    }
  }

  it('creates the schema with WAL, incremental auto_vacuum and private permissions', async () => {
    expect(pragma('user_version')).toBe(SCHEMA_VERSION)
    expect(pragma('journal_mode')).toBe('wal')
    expect(pragma('auto_vacuum')).toBe(2)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const db = raw()
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all()
      .map((row) => (row as { name: string }).name)
    db.close()
    expect(tables).toEqual(['audit_event', 'meta', 'run_fact', 'run_model_usage', 'tool_fact'])
  })

  it('refuses a database written by a newer schema', () => {
    store.close()
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()
    expect(() => SqliteDataStore.open(path)).toThrow(/newer than this runner supports/)
    store = SqliteDataStore.open(join(dir, 'other.db'))
  })

  it('projects a run lifecycle into audit rows, run_fact and run_model_usage', () => {
    const result = store.writeBatch([
      started('run-1'),
      { kind: 'run.session', runId: 'run-1', sessionId: 'sess-1' },
      finished('run-1', NOW.toISOString(), { numTurns: 3, apiDurationMs: 900 }),
    ])
    expect(result).toEqual({ accepted: 3, rejected: 0, orphans: 0, errors: [] })

    const db = raw()
    const run = db.prepare('SELECT * FROM run_fact').get() as Record<string, unknown>
    expect(run).toMatchObject({
      run_id: 'run-1', session_id: 'sess-1', provider: 'pi', model: 'gpt-x', source: 'web',
      prompt_chars: 12, attachment_count: 0, outcome: 'completed', failure_code: null,
      duration_ms: 1500, api_duration_ms: 900, num_turns: 3,
      input_tokens: 10, output_tokens: 20, cache_read_tokens: 1000, cache_write_tokens: 150, cost_usd: 0.01,
    })
    expect(run['started_audit_id']).not.toBeNull()
    expect(run['finished_audit_id']).not.toBeNull()

    const models = db.prepare('SELECT * FROM run_model_usage').all()
    expect(models).toEqual([
      expect.objectContaining({ model: 'gpt-x', input_tokens: 10, output_tokens: 20, cache_read_tokens: 1000, cost_usd: 0.01 }),
    ])

    const audits = db.prepare('SELECT action, run_id, details FROM audit_event ORDER BY id').all() as {
      action: string; run_id: string; details: string
    }[]
    expect(audits.map((row) => row.action)).toEqual(['run.started', 'run.finished'])
    expect(JSON.parse(audits[0]?.details ?? '')).toEqual({ text: 'hi' })
    db.close()
  })

  it('stores per-model usage when the run reports a breakdown', () => {
    store.writeBatch([
      started('run-2'),
      finished('run-2', NOW.toISOString(), {
        byModel: {
          'gpt-x': { input: 5, output: 15, cacheRead: 500, costUsd: 0.004 },
          'gpt-mini': { input: 5, output: 5, costUsd: 0.001 },
        },
      }),
    ])
    const db = raw()
    const rows = db.prepare('SELECT model, input_tokens, cache_read_tokens, cost_usd FROM run_model_usage ORDER BY model').all()
    db.close()
    expect(rows).toEqual([
      { model: 'gpt-mini', input_tokens: 5, cache_read_tokens: null, cost_usd: 0.001 },
      { model: 'gpt-x', input_tokens: 5, cache_read_tokens: 500, cost_usd: 0.004 },
    ])
  })

  it('defaults a failed run without a code to unknown and ignores codes on completed runs', () => {
    store.writeBatch([
      started('run-3'), finished('run-3', NOW.toISOString(), { outcome: 'failed' }),
      started('run-4'), finished('run-4', NOW.toISOString(), { outcome: 'completed', failureCode: 'api_error' }),
      started('run-5'),
      { kind: 'run.finished', tsUtc: NOW.toISOString(), runId: 'run-5', outcome: 'aborted', durationMs: 5, details: {} },
    ])
    const db = raw()
    const rows = db.prepare('SELECT run_id, outcome, failure_code, input_tokens FROM run_fact ORDER BY id').all()
    db.close()
    expect(rows).toEqual([
      { run_id: 'run-3', outcome: 'failed', failure_code: 'unknown', input_tokens: 10 },
      { run_id: 'run-4', outcome: 'completed', failure_code: null, input_tokens: 10 },
      { run_id: 'run-5', outcome: 'aborted', failure_code: null, input_tokens: null },
    ])
  })

  it('records tools with the MCP server parsed out of the name', () => {
    store.writeBatch([
      started('run-6'),
      tool('run-6', 'tu-1', 'Read'),
      tool('run-6', 'tu-2', 'mcp__github__search_issues'),
    ])
    const db = raw()
    const rows = db.prepare('SELECT tool_name, mcp_server, ok, duration_ms FROM tool_fact ORDER BY id').all()
    const audit = db.prepare(`SELECT target FROM audit_event WHERE action = 'tool.invoked' ORDER BY id`).all()
    db.close()
    expect(rows).toEqual([
      { tool_name: 'Read', mcp_server: null, ok: 1, duration_ms: 40 },
      { tool_name: 'mcp__github__search_issues', mcp_server: 'github', ok: 1, duration_ms: 40 },
    ])
    expect(audit).toEqual([{ target: 'Read' }, { target: 'mcp__github__search_issues' }])
  })

  it('isolates a bad record without losing the rest of the batch', () => {
    const result = store.writeBatch([
      started('run-7'),
      { kind: 'audit', tsUtc: 'not a date', action: 'x', details: null },
      { ...started('run-8'), source: 'nope' as RunSource },
      finished('run-7'),
    ])
    expect(result.accepted).toBe(2)
    expect(result.rejected).toBe(2)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toMatch(/Invalid timestamp/)
    expect(result.errors[1]).toMatch(/CHECK constraint/)
    const db = raw()
    expect(db.prepare('SELECT COUNT(*) AS n FROM run_fact').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_event').get()).toEqual({ n: 2 })
    db.close()
  })

  it('keeps the audit row but reports an orphan when the run was never started', () => {
    const result = store.writeBatch([
      finished('ghost'),
      { kind: 'run.session', runId: 'ghost', sessionId: 's' },
    ])
    expect(result).toMatchObject({ accepted: 2, rejected: 0, orphans: 2 })
    const db = raw()
    expect(db.prepare('SELECT COUNT(*) AS n FROM run_fact').get()).toEqual({ n: 0 })
    expect(db.prepare(`SELECT action FROM audit_event`).all()).toEqual([{ action: 'run.finished' }])
    db.close()
  })

  it('does not let a second run.finished overwrite a closed run', () => {
    store.writeBatch([started('run-9'), finished('run-9')])
    const again = store.writeBatch([finished('run-9', NOW.toISOString(), { outcome: 'failed' })])
    expect(again.orphans).toBe(1)
    const db = raw()
    expect(db.prepare('SELECT outcome FROM run_fact').get()).toEqual({ outcome: 'completed' })
    db.close()
  })

  it('closes runs left running by a previous process as crashes', () => {
    store.writeBatch([started('run-a'), started('run-b'), finished('run-b')])
    expect(store.reconcileRunning(NOW.toISOString())).toBe(1)
    expect(store.reconcileRunning(NOW.toISOString())).toBe(0)
    const db = raw()
    const rows = db.prepare('SELECT run_id, outcome, failure_code, finished_utc FROM run_fact ORDER BY id').all()
    expect(rows).toEqual([
      { run_id: 'run-a', outcome: 'failed', failure_code: 'runtime_crash', finished_utc: NOW.toISOString() },
      { run_id: 'run-b', outcome: 'completed', failure_code: null, finished_utc: NOW.toISOString() },
    ])
    expect(db.prepare(`SELECT run_id FROM audit_event WHERE action = 'run.reconciled'`).all()).toEqual([{ run_id: 'run-a' }])
    expect(store.status()).toMatchObject({ runFacts: 2, runningRuns: 0 })
    db.close()
  })

  describe('retention pruning', () => {
    const retention = { auditRetentionDays: 90, toolAuditRetentionDays: 30, factRetentionDays: 365 }

    function runPrune(): void {
      const job = store.createPruneJob(retention, NOW)
      while (!job.step()) { /* drain */ }
    }

    it('applies the three retention windows and detaches facts from pruned audit rows', () => {
      store.writeBatch([
        started('old', daysAgo(366)), finished('old', daysAgo(366)),
        started('kept-fact', daysAgo(364)), finished('kept-fact', daysAgo(364)),
        started('fresh'), finished('fresh'),
        tool('kept-fact', 'tu-old', 'Read', daysAgo(31)),
        tool('kept-fact', 'tu-new', 'Read', daysAgo(29)),
        { kind: 'audit', tsUtc: daysAgo(91), action: 'session.renamed', details: null },
        { kind: 'audit', tsUtc: daysAgo(89), action: 'session.renamed', details: null },
      ])
      runPrune()

      const db = raw()
      const runs = db.prepare('SELECT run_id, started_audit_id, finished_audit_id FROM run_fact ORDER BY id').all() as Record<string, unknown>[]
      expect(runs.map((row) => row['run_id'])).toEqual(['kept-fact', 'fresh'])
      // kept-fact is 364 days old: its facts survive but its audit rows (90 days) are gone.
      expect(runs[0]).toMatchObject({ started_audit_id: null, finished_audit_id: null })
      expect(runs[1]?.['started_audit_id']).not.toBeNull()
      expect(db.prepare('SELECT COUNT(*) AS n FROM run_model_usage').get()).toEqual({ n: 2 })

      const tools = db.prepare('SELECT tool_use_id, audit_id FROM tool_fact ORDER BY id').all()
      expect(tools).toEqual([
        { tool_use_id: 'tu-old', audit_id: null },
        { tool_use_id: 'tu-new', audit_id: expect.any(Number) as number },
      ])

      const audits = db.prepare('SELECT action, ts_utc FROM audit_event ORDER BY id').all() as { action: string; ts_utc: string }[]
      expect(audits.map((row) => row.action)).toEqual([
        'run.started', 'run.finished', 'tool.invoked', 'session.renamed', 'retention.pruned',
      ])
      expect(audits.find((row) => row.action === 'session.renamed')?.ts_utc).toBe(daysAgo(89))
      const pruned = db.prepare(`SELECT details FROM audit_event WHERE action = 'retention.pruned'`).get() as { details: string }
      // old + kept-fact run.started/finished (4) and the 91-day session.renamed
      expect(JSON.parse(pruned.details)).toMatchObject({
        auditDeleted: 5, toolAuditDeleted: 1, toolFactDeleted: 0, runFactDeleted: 1,
      })
      db.close()
      expect(store.lastPruneUtc()).toBe(NOW.toISOString())
    })

    it('deletes in bounded chunks so writes can interleave', () => {
      const records: DataRecord[] = []
      for (let index = 0; index < 4500; index += 1) {
        records.push({ kind: 'audit', tsUtc: daysAgo(100), action: 'session.renamed', details: null })
      }
      store.writeBatch(records)
      const job = store.createPruneJob(retention, NOW)
      let unfinishedSteps = 0
      while (!job.step()) unfinishedSteps += 1
      // 1 empty tool-audit phase + 3 chunks (2000 + 2000 + 500) + 2 empty fact
      // phases, then the finalising step reports completion.
      expect(unfinishedSteps).toBe(6)
      expect(job.result.auditDeleted).toBe(4500)
      expect(store.status().auditEvents).toBe(1)
    })

    it('does nothing destructive with default retention on fresh data', () => {
      store.writeBatch([started('r'), finished('r'), tool('r', 't', 'Bash')])
      const job = store.createPruneJob(defaultDataRetention(), NOW)
      while (!job.step()) { /* drain */ }
      expect(store.status()).toMatchObject({ auditEvents: 4, runFacts: 1, toolFacts: 1 })
    })
  })
})
