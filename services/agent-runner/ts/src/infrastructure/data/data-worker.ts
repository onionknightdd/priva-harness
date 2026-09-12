import { parentPort, workerData } from 'node:worker_threads'

import type { DataWorkerInit, MainToWorkerMessage, WorkerToMainMessage } from './data-worker-protocol.js'
import { SqliteDataStore, type PruneJob } from './sqlite-data-store.js'

// Worker-thread entry. Owns the only SQLite connection so no synchronous
// statement ever runs on the main thread. Messages arrive in order and are
// applied in order, which is what lets run.started precede run.finished
// without any locking.

const port = requirePort()
const init = workerData as DataWorkerInit

function requirePort(): NonNullable<typeof parentPort> {
  if (parentPort === null) throw new Error('data-worker must run as a worker thread')
  return parentPort
}

function post(message: WorkerToMainMessage): void {
  port.postMessage(message)
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  post({ type: 'log', level, message })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const store = SqliteDataStore.open(init.dbPath)
try {
  store.markPruneBaseline(new Date().toISOString())
  const reconciled = store.reconcileRunning(new Date().toISOString())
  if (reconciled > 0) log('warn', `data store: closed ${reconciled} run(s) left running by a previous process`)
} catch (error) {
  log('error', `data store: startup reconciliation failed: ${describe(error)}`)
}

let pruneJob: PruneJob | undefined
let lastPruneAttemptMs = 0

function pruneDue(): boolean {
  if (pruneJob !== undefined) return false
  const now = Date.now()
  if (now - lastPruneAttemptMs < init.pruneIntervalMs) return false
  const last = store.lastPruneUtc()
  return last === null || now - new Date(last).getTime() >= init.pruneIntervalMs
}

// Each chunk is one short transaction; yielding through setImmediate lets
// queued writes interleave instead of waiting behind a multi-second DELETE.
function stepPrune(): void {
  const job = pruneJob
  if (job === undefined) return
  try {
    if (job.step()) {
      pruneJob = undefined
      const r = job.result
      log('info', `data store: pruned audit=${r.auditDeleted} toolAudit=${r.toolAuditDeleted} `
        + `toolFacts=${r.toolFactDeleted} runFacts=${r.runFactDeleted} in ${r.elapsedMs}ms`)
      return
    }
  } catch (error) {
    pruneJob = undefined
    log('error', `data store: retention pruning failed: ${describe(error)}`)
    return
  }
  setImmediate(stepPrune)
}

function maybeStartPrune(): void {
  if (!pruneDue()) return
  lastPruneAttemptMs = Date.now()
  pruneJob = store.createPruneJob(init.retention, new Date())
  setImmediate(stepPrune)
}

function handle(message: MainToWorkerMessage): void {
  switch (message.type) {
    case 'write': {
      try {
        const result = store.writeBatch(message.records)
        if (result.rejected > 0) {
          log('error', `data store: rejected ${result.rejected} record(s): ${result.errors.join(' | ')}`)
        }
        if (result.orphans > 0) {
          log('warn', `data store: ${result.orphans} record(s) referenced a run that was never started`)
        }
      } catch (error) {
        log('error', `data store: dropped a batch of ${message.records.length} record(s): ${describe(error)}`)
      }
      maybeStartPrune()
      return
    }
    case 'flush':
      post({ type: 'flushed', id: message.id })
      return
    case 'status': {
      try {
        post({ type: 'status', id: message.id, status: store.status() })
      } catch (error) {
        post({ type: 'failed', id: message.id, message: describe(error) })
      }
      return
    }
    case 'overview': {
      try {
        post({ type: 'overview', id: message.id, overview: store.overview(message.input, init.retention) })
      } catch (error) {
        post({ type: 'failed', id: message.id, message: describe(error) })
      }
      return
    }
    case 'auditPage': {
      try {
        post({ type: 'auditPage', id: message.id, page: store.auditPage(message.input) })
      } catch (error) {
        post({ type: 'failed', id: message.id, message: describe(error) })
      }
      return
    }
    case 'close': {
      pruneJob = undefined
      try {
        store.close()
      } catch (error) {
        log('error', `data store: close failed: ${describe(error)}`)
      }
      post({ type: 'closed' })
      port.close()
    }
  }
}

port.on('message', (message: MainToWorkerMessage) => {
  handle(message)
})
post({ type: 'ready' })
maybeStartPrune()
