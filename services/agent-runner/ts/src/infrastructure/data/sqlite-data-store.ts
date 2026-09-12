import { chmodSync } from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

import type {
  DataRecord,
  DataRetention,
  DataStoreStatus,
  RunFinishedRecord,
  RunStartedRecord,
  ToolRecord,
} from '../../core/resource/data-store.js'
import { migrateSchema } from './sqlite-schema.js'

const MCP_TOOL_SERVER = /^mcp__([a-zA-Z0-9_-]+)__/
const PRUNE_CHUNK_ROWS = 2000
const INCREMENTAL_VACUUM_PAGES = 512
const META_LAST_PRUNE = 'last_prune_utc'
const MAX_REPORTED_ERRORS = 5

export interface WriteBatchResult {
  readonly accepted: number
  readonly rejected: number
  // Facts whose run row was never created (e.g. run.started dropped from a
  // full queue). The audit row is still kept.
  readonly orphans: number
  readonly errors: readonly string[]
}

export interface PruneResult {
  auditDeleted: number
  toolAuditDeleted: number
  toolFactDeleted: number
  runFactDeleted: number
  elapsedMs: number
}

export interface PruneJob {
  // Runs one bounded chunk; returns true once every phase has finished.
  step(): boolean
  readonly result: PruneResult
}

// Synchronous SQLite access. Lives on the data worker thread; only tests use
// it directly from the main thread.
export class SqliteDataStore {
  private readonly db: DatabaseSync
  private readonly insertAudit: StatementSync
  private readonly insertRun: StatementSync
  private readonly attachSession: StatementSync
  private readonly finishRun: StatementSync
  private readonly runRowId: StatementSync
  private readonly insertModelUsage: StatementSync
  private readonly insertTool: StatementSync
  private readonly getMeta: StatementSync
  private readonly setMeta: StatementSync

  static open(path: string): SqliteDataStore {
    const db = new DatabaseSync(path)
    try {
      chmodSync(path, 0o600)
      if (isEmptyDatabase(db)) {
        // Only honoured before the file holds any table, and switching the
        // journal mode already initialises the file, so this has to come first.
        db.exec('PRAGMA auto_vacuum = INCREMENTAL')
      }
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA synchronous = NORMAL')
      db.exec('PRAGMA foreign_keys = ON')
      migrateSchema(db)
      return new SqliteDataStore(db)
    } catch (error) {
      db.close()
      throw error
    }
  }

  constructor(db: DatabaseSync) {
    this.db = db
    this.insertAudit = db.prepare(`
      INSERT INTO audit_event (ts_utc, action, session_id, run_id, target, details)
      VALUES (?, ?, ?, ?, ?, ?)`)
    this.insertRun = db.prepare(`
      INSERT INTO run_fact (
        run_id, started_audit_id, started_utc, session_id, provider, profile_id, model, source,
        prompt_chars, attachment_count, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')`)
    this.attachSession = db.prepare(`
      UPDATE run_fact SET session_id = ?
       WHERE id = (SELECT MAX(id) FROM run_fact WHERE run_id = ?)`)
    this.finishRun = db.prepare(`
      UPDATE run_fact SET
        finished_audit_id = ?, finished_utc = ?, outcome = ?, failure_code = ?,
        duration_ms = ?, api_duration_ms = ?, num_turns = ?,
        input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?, cost_usd = ?
       WHERE id = (SELECT MAX(id) FROM run_fact WHERE run_id = ? AND outcome = 'running')`)
    this.runRowId = db.prepare(`SELECT id, model FROM run_fact WHERE run_id = ? ORDER BY id DESC LIMIT 1`)
    this.insertModelUsage = db.prepare(`
      INSERT INTO run_model_usage (
        run_fact_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    this.insertTool = db.prepare(`
      INSERT INTO tool_fact (
        audit_id, run_id, ts_utc, tool_use_id, tool_name, mcp_server, ok, duration_ms, output_tokens, agent_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    this.getMeta = db.prepare('SELECT value FROM meta WHERE key = ?')
    this.setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  }

  writeBatch(records: readonly DataRecord[]): WriteBatchResult {
    let accepted = 0
    let rejected = 0
    let orphans = 0
    const errors: string[] = []
    this.db.exec('BEGIN')
    try {
      for (const record of records) {
        this.db.exec('SAVEPOINT record')
        try {
          if (this.writeOne(record) === 'orphan') orphans += 1
          this.db.exec('RELEASE record')
          accepted += 1
        } catch (error) {
          this.db.exec('ROLLBACK TO record')
          this.db.exec('RELEASE record')
          rejected += 1
          if (errors.length < MAX_REPORTED_ERRORS) {
            errors.push(`${record.kind}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return { accepted, rejected, orphans, errors }
  }

  // Rows still 'running' at startup belong to a previous process: no run can
  // survive a restart, so they are closed as crashes.
  reconcileRunning(nowUtc: string): number {
    const ts = normalizeUtc(nowUtc)
    const rows = this.db.prepare(`SELECT id, run_id FROM run_fact WHERE outcome = 'running'`).all() as {
      id: number
      run_id: string
    }[]
    if (rows.length === 0) return 0
    this.db.exec('BEGIN')
    try {
      const close = this.db.prepare(`
        UPDATE run_fact SET outcome = 'failed', failure_code = 'runtime_crash', finished_utc = ?, finished_audit_id = ?
         WHERE id = ?`)
      for (const row of rows) {
        const auditId = this.audit(ts, 'run.reconciled', null, row.run_id, null, { runId: row.run_id })
        close.run(ts, auditId, row.id)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return rows.length
  }

  lastPruneUtc(): string | null {
    const row = this.getMeta.get(META_LAST_PRUNE) as { value: string } | undefined
    return row?.value ?? null
  }

  // A fresh database has nothing to prune; recording the baseline starts the
  // retention clock without producing a retention.pruned audit row.
  markPruneBaseline(nowUtc: string): void {
    if (this.lastPruneUtc() !== null) return
    this.setMeta.run(META_LAST_PRUNE, normalizeUtc(nowUtc))
  }

  createPruneJob(retention: DataRetention, now: Date): PruneJob {
    const nowUtc = now.toISOString()
    const cutoff = (days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString()
    const auditCutoff = cutoff(retention.auditRetentionDays)
    const toolAuditCutoff = cutoff(retention.toolAuditRetentionDays)
    const factCutoff = cutoff(retention.factRetentionDays)
    const startedAt = Date.now()
    const result: PruneResult = { auditDeleted: 0, toolAuditDeleted: 0, toolFactDeleted: 0, runFactDeleted: 0, elapsedMs: 0 }

    const phases: (() => number)[] = [
      () => this.deleteChunk(
        `DELETE FROM audit_event WHERE id IN (
           SELECT id FROM audit_event WHERE action = 'tool.invoked' AND ts_utc < ? LIMIT ${PRUNE_CHUNK_ROWS})`,
        toolAuditCutoff,
      ),
      () => this.deleteChunk(
        `DELETE FROM audit_event WHERE id IN (
           SELECT id FROM audit_event WHERE action != 'tool.invoked' AND ts_utc < ? LIMIT ${PRUNE_CHUNK_ROWS})`,
        auditCutoff,
      ),
      () => this.deleteChunk(
        `DELETE FROM tool_fact WHERE id IN (
           SELECT id FROM tool_fact WHERE ts_utc < ? LIMIT ${PRUNE_CHUNK_ROWS})`,
        factCutoff,
      ),
      () => this.deleteChunk(
        `DELETE FROM run_fact WHERE id IN (
           SELECT id FROM run_fact WHERE outcome != 'running' AND started_utc < ? LIMIT ${PRUNE_CHUNK_ROWS})`,
        factCutoff,
      ),
    ]
    const counters: (keyof PruneResult)[] = ['toolAuditDeleted', 'auditDeleted', 'toolFactDeleted', 'runFactDeleted']
    let phase = 0
    let finished = false

    return {
      result,
      step: (): boolean => {
        if (finished) return true
        const run = phases[phase]
        const counter = counters[phase]
        if (run !== undefined && counter !== undefined) {
          const deleted = run()
          result[counter] += deleted
          if (deleted < PRUNE_CHUNK_ROWS) phase += 1
          return false
        }
        this.db.exec(`PRAGMA incremental_vacuum(${INCREMENTAL_VACUUM_PAGES})`)
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
        result.elapsedMs = Date.now() - startedAt
        this.db.exec('BEGIN')
        try {
          this.audit(nowUtc, 'retention.pruned', null, null, null, { ...result, retention })
          this.setMeta.run(META_LAST_PRUNE, nowUtc)
          this.db.exec('COMMIT')
        } catch (error) {
          this.db.exec('ROLLBACK')
          throw error
        }
        finished = true
        return true
      },
    }
  }

  status(): DataStoreStatus {
    const count = (sql: string): number => (this.db.prepare(sql).get() as { n: number }).n
    return {
      auditEvents: count('SELECT COUNT(*) AS n FROM audit_event'),
      runFacts: count('SELECT COUNT(*) AS n FROM run_fact'),
      toolFacts: count('SELECT COUNT(*) AS n FROM tool_fact'),
      runningRuns: count(`SELECT COUNT(*) AS n FROM run_fact WHERE outcome = 'running'`),
      lastPruneUtc: this.lastPruneUtc(),
    }
  }

  close(): void {
    this.db.close()
  }

  private writeOne(record: DataRecord): 'ok' | 'orphan' {
    switch (record.kind) {
      case 'audit': {
        this.audit(
          normalizeUtc(record.tsUtc), record.action,
          record.sessionId ?? null, record.runId ?? null, record.target ?? null, record.details,
        )
        return 'ok'
      }
      case 'run.started':
        return this.writeRunStarted(record)
      case 'run.session': {
        const { changes } = this.attachSession.run(record.sessionId, record.runId)
        return Number(changes) === 0 ? 'orphan' : 'ok'
      }
      case 'run.finished':
        return this.writeRunFinished(record)
      case 'tool':
        return this.writeTool(record)
    }
  }

  private writeRunStarted(record: RunStartedRecord): 'ok' {
    const ts = normalizeUtc(record.tsUtc)
    const auditId = this.audit(ts, 'run.started', record.sessionId ?? null, record.runId, null, record.details)
    this.insertRun.run(
      record.runId, auditId, ts, record.sessionId ?? null, record.provider, record.profileId ?? null,
      record.model, record.source, record.promptChars, record.attachmentCount,
    )
    return 'ok'
  }

  private writeRunFinished(record: RunFinishedRecord): 'ok' | 'orphan' {
    const ts = normalizeUtc(record.tsUtc)
    const auditId = this.audit(ts, 'run.finished', record.sessionId ?? null, record.runId, null, record.details)
    const failureCode = record.outcome === 'failed' ? (record.failureCode ?? 'unknown') : null
    const usage = record.usage
    const { changes } = this.finishRun.run(
      auditId, ts, record.outcome, failureCode,
      record.durationMs, record.apiDurationMs ?? null, record.numTurns ?? null,
      usage?.input ?? null, usage?.output ?? null, usage?.cacheRead ?? null, usage?.cacheWrite ?? null,
      record.costUsd ?? null,
      record.runId,
    )
    if (Number(changes) === 0) return 'orphan'

    const row = this.runRowId.get(record.runId) as { id: number; model: string } | undefined
    if (row === undefined) return 'orphan'
    const byModel = record.byModel ?? (usage === undefined
      ? {}
      : { [row.model]: { ...usage, ...(record.costUsd === undefined ? {} : { costUsd: record.costUsd }) } })
    for (const [model, modelUsage] of Object.entries(byModel)) {
      this.insertModelUsage.run(
        row.id, model, modelUsage.input, modelUsage.output,
        modelUsage.cacheRead ?? null, modelUsage.cacheWrite ?? null, modelUsage.costUsd ?? null,
      )
    }
    return 'ok'
  }

  private writeTool(record: ToolRecord): 'ok' {
    const ts = normalizeUtc(record.tsUtc)
    const auditId = this.audit(ts, 'tool.invoked', record.sessionId ?? null, record.runId, record.toolName, record.details)
    this.insertTool.run(
      auditId, record.runId, ts, record.toolUseId, record.toolName,
      MCP_TOOL_SERVER.exec(record.toolName)?.[1] ?? null,
      record.ok ? 1 : 0, record.durationMs ?? null, record.outputTokens ?? null, record.agentId ?? null,
    )
    return 'ok'
  }

  private audit(
    tsUtc: string,
    action: string,
    sessionId: string | null,
    runId: string | null,
    target: string | null,
    details: unknown,
  ): number {
    const { lastInsertRowid } = this.insertAudit.run(
      tsUtc, action, sessionId, runId, target, JSON.stringify(details ?? null),
    )
    return Number(lastInsertRowid)
  }

  private deleteChunk(sql: string, cutoff: string): number {
    return Number(this.db.prepare(sql).run(cutoff).changes)
  }
}

function isEmptyDatabase(db: DatabaseSync): boolean {
  const row = db.prepare('PRAGMA page_count').get() as { page_count: number }
  return row.page_count === 0
}

function normalizeUtc(value: string): string {
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) throw new TypeError(`Invalid timestamp: ${value}`)
  return new Date(time).toISOString()
}
