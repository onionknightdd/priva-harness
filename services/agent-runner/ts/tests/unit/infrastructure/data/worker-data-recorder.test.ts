import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultDataRetention, type DataRecord, type DataStoreLogger } from '../../../../src/core/resource/data-store.js'
import { SqliteDataStore } from '../../../../src/infrastructure/data/sqlite-data-store.js'
import { WorkerDataRecorder, type WorkerDataRecorderOptions } from '../../../../src/infrastructure/data/worker-data-recorder.js'

function started(runId: string): DataRecord {
  return {
    kind: 'run.started', tsUtc: new Date().toISOString(), runId, provider: 'claude', model: 'm', source: 'web',
    promptChars: 1, attachmentCount: 0, details: null,
  }
}

function finished(runId: string): DataRecord {
  return {
    kind: 'run.finished', tsUtc: new Date().toISOString(), runId, outcome: 'completed', durationMs: 1,
    usage: { input: 1, output: 1 }, details: null,
  }
}

function collectingLogger(): DataStoreLogger & { readonly lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    info: (message) => { lines.push(`info ${message}`) },
    warn: (message) => { lines.push(`warn ${message}`) },
    error: (message) => { lines.push(`error ${message}`) },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('WorkerDataRecorder', () => {
  let dir: string
  let dbPath: string
  let logger: ReturnType<typeof collectingLogger>
  const recorders: WorkerDataRecorder[] = []

  function create(overrides: Partial<WorkerDataRecorderOptions> = {}): WorkerDataRecorder {
    const recorder = new WorkerDataRecorder({
      dbPath, retention: defaultDataRetention(), logger, pruneIntervalMs: 60_000, ...overrides,
    })
    recorders.push(recorder)
    return recorder
  }

  function rows(sql: string): unknown[] {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      return db.prepare(sql).all()
    } finally {
      db.close()
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'priva-data-worker-'))
    dbPath = join(dir, '.data.db')
    logger = collectingLogger()
  })

  afterEach(async () => {
    await Promise.all(recorders.splice(0).map(async (recorder) => { await recorder.close() }))
    await rm(dir, { recursive: true, force: true })
  })

  it('applies records in order on the worker and flush waits for them', async () => {
    const recorder = create()
    recorder.record(started('r1'))
    recorder.start()
    recorder.record({ kind: 'run.session', runId: 'r1', sessionId: 's1' })
    recorder.record(finished('r1'))
    recorder.record({ kind: 'tool', tsUtc: new Date().toISOString(), runId: 'r1', toolUseId: 't', toolName: 'Bash', ok: false, details: { input: { command: 'ls' } } })

    expect(await recorder.flush()).toBe(true)
    expect(rows('SELECT run_id, session_id, outcome FROM run_fact')).toEqual([{ run_id: 'r1', session_id: 's1', outcome: 'completed' }])
    expect(rows('SELECT tool_name, ok FROM tool_fact')).toEqual([{ tool_name: 'Bash', ok: 0 }])
    expect(rows('SELECT action FROM audit_event ORDER BY id')).toEqual([
      { action: 'run.started' }, { action: 'run.finished' }, { action: 'tool.invoked' },
    ])
    // A fresh database only records the retention baseline; no retention.pruned row.
    expect(await recorder.status()).toMatchObject({
      auditEvents: 3, runFacts: 1, toolFacts: 1, runningRuns: 0, lastPruneUtc: expect.any(String) as string,
    })
    expect(logger.lines.filter((line) => line.startsWith('error'))).toEqual([])
  })

  it('drops the oldest records once the queue is full and keeps counting', async () => {
    const recorder = create({ queueLimit: 3 })
    for (let index = 0; index < 5; index += 1) {
      recorder.record({ kind: 'audit', tsUtc: new Date().toISOString(), action: `a${index}`, details: null })
    }
    expect(recorder.dropped).toBe(2)
    expect(recorder.queued).toBe(3)
    expect(logger.lines).toEqual(['warn data store: queue full, dropped 1 record(s) so far'])

    recorder.start()
    expect(await recorder.flush()).toBe(true)
    expect(rows('SELECT action FROM audit_event ORDER BY id')).toEqual([{ action: 'a2' }, { action: 'a3' }, { action: 'a4' }])
  })

  it('never throws from record and reports worker-side rejections through the logger', async () => {
    const recorder = create()
    recorder.start()
    expect(() => {
      recorder.record({ kind: 'audit', tsUtc: 'garbage', action: 'x', details: null })
      recorder.record({ kind: 'audit', tsUtc: new Date().toISOString(), action: 'uncloneable', details: { fn: () => 1 } })
      recorder.record({ kind: 'audit', tsUtc: new Date().toISOString(), action: 'ok', details: null })
    }).not.toThrow()
    expect(await recorder.flush()).toBe(true)
    await waitFor(() => logger.lines.some((line) => line.includes('rejected 1 record(s)')))
    expect(logger.lines.some((line) => line.includes('dropped unserializable audit record'))).toBe(true)
    expect(recorder.dropped).toBe(1)
    expect(rows('SELECT action FROM audit_event')).toEqual([{ action: 'ok' }])
  })

  it('restarts the worker after a crash and drains the queue afterwards', async () => {
    dbPath = join(dir, 'missing', '.data.db')
    const recorder = create({ restartBackoffMs: [50] })
    recorder.record(started('r1'))
    recorder.start()

    await waitFor(() => logger.lines.filter((line) => line.includes('worker exited')).length >= 2)
    expect(recorder.queued).toBe(1)

    await mkdir(join(dir, 'missing'), { recursive: true })
    await waitFor(() => recorder.queued === 0)
    recorder.record(finished('r1'))
    expect(await recorder.flush()).toBe(true)
    expect(rows('SELECT run_id, outcome FROM run_fact')).toEqual([{ run_id: 'r1', outcome: 'completed' }])
  })

  it('closes runs left running by a previous process on startup', async () => {
    const first = create()
    first.start()
    first.record(started('orphaned'))
    await first.flush()
    await first.close()
    expect(rows(`SELECT outcome FROM run_fact`)).toEqual([{ outcome: 'running' }])

    const second = create()
    second.start()
    await waitFor(() => logger.lines.some((line) => line.includes('left running by a previous process')))
    expect(await second.status()).toMatchObject({ runningRuns: 0, runFacts: 1 })
    expect(rows('SELECT outcome, failure_code FROM run_fact')).toEqual([{ outcome: 'failed', failure_code: 'runtime_crash' }])
  })

  it('prunes on the worker according to the retention settings', async () => {
    const seed = SqliteDataStore.open(dbPath)
    seed.writeBatch([{ kind: 'audit', tsUtc: new Date(Date.now() - 3 * 86_400_000).toISOString(), action: 'stale', details: null }])
    seed.close()

    const recorder = create({ pruneIntervalMs: 0, retention: { auditRetentionDays: 1, toolAuditRetentionDays: 1, factRetentionDays: 1 } })
    recorder.start()
    await waitFor(() => logger.lines.some((line) => line.includes('pruned audit=1')))
    expect(rows('SELECT DISTINCT action FROM audit_event')).toEqual([{ action: 'retention.pruned' }])
    expect((await recorder.status()).lastPruneUtc).not.toBeNull()
  })

  it('ignores records after close and flushes before terminating', async () => {
    const recorder = create()
    recorder.start()
    recorder.record({ kind: 'audit', tsUtc: new Date().toISOString(), action: 'before', details: null })
    await recorder.close()
    recorder.record({ kind: 'audit', tsUtc: new Date().toISOString(), action: 'after', details: null })
    expect(rows('SELECT action FROM audit_event')).toEqual([{ action: 'before' }])
    await expect(recorder.status()).rejects.toThrow(/not running/)
  })
})
