import { Worker } from 'node:worker_threads'

import type { DataRecorder } from '../../core/contract/data-recorder.js'
import type { UsageReader } from '../../core/contract/usage-reader.js'
import type {
  DataRecord,
  DataRetention,
  DataStoreLogger,
  DataStoreStatus,
} from '../../core/resource/data-store.js'
import type {
  AuditPage,
  AuditPageInput,
  UsageOverview,
  UsageOverviewInput,
} from '../../core/resource/usage-overview.js'
import type { DataWorkerInit, MainToWorkerMessage, WorkerToMainMessage } from './data-worker-protocol.js'

const DEFAULT_QUEUE_LIMIT = 10_000
const DEFAULT_FLUSH_TIMEOUT_MS = 2_000
const DEFAULT_QUERY_TIMEOUT_MS = 5_000
const DEFAULT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000
const MAX_RECORDS_PER_MESSAGE = 500
const DROP_LOG_EVERY = 1_000
const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const

export interface WorkerDataRecorderOptions {
  readonly dbPath: string
  readonly retention: DataRetention
  readonly logger?: DataStoreLogger
  readonly queueLimit?: number
  readonly flushTimeoutMs?: number
  readonly queryTimeoutMs?: number
  readonly pruneIntervalMs?: number
  readonly restartBackoffMs?: readonly number[]
}

interface Pending<T> {
  resolve(value: T): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

// Main-thread side of the data pipeline. record() only appends to a bounded
// in-memory queue and returns; everything else happens on the worker. The
// business flow is never awaited on, never blocked by and never failed by
// anything in here.
export class WorkerDataRecorder implements DataRecorder, UsageReader {
  private readonly options: Required<Omit<WorkerDataRecorderOptions, 'logger'>>
  private readonly logger: DataStoreLogger
  private readonly queue: DataRecord[] = []
  private readonly pending = new Map<number, Pending<WorkerToMainMessage>>()
  private readonly readyWaiters = new Set<(ready: boolean) => void>()
  private worker: Worker | undefined
  private ready = false
  private sendScheduled = false
  private closing = false
  private restartAttempts = 0
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  private nextRequestId = 1
  private droppedCount = 0

  constructor(options: WorkerDataRecorderOptions) {
    this.options = {
      dbPath: options.dbPath,
      retention: options.retention,
      queueLimit: options.queueLimit ?? DEFAULT_QUEUE_LIMIT,
      flushTimeoutMs: options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS,
      queryTimeoutMs: options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
      pruneIntervalMs: options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS,
      restartBackoffMs: options.restartBackoffMs ?? RESTART_BACKOFF_MS,
    }
    this.logger = options.logger ?? consoleLogger()
  }

  get dropped(): number {
    return this.droppedCount
  }

  get queued(): number {
    return this.queue.length
  }

  start(): void {
    if (this.worker !== undefined || this.closing) return
    try {
      this.spawn()
    } catch (error) {
      this.logger.error(`data store: could not start worker: ${describe(error)}`)
      this.scheduleRestart()
    }
  }

  record(record: DataRecord): void {
    if (this.closing) return
    if (this.queue.length >= this.options.queueLimit) {
      this.queue.shift()
      this.droppedCount += 1
      if (this.droppedCount % DROP_LOG_EVERY === 1) {
        this.logger.warn(`data store: queue full, dropped ${this.droppedCount} record(s) so far`)
      }
    }
    this.queue.push(record)
    this.scheduleSend()
  }

  // Resolves true once the worker has applied everything recorded so far,
  // false if that did not happen within the timeout.
  async flush(timeoutMs = this.options.flushTimeoutMs): Promise<boolean> {
    if (this.worker === undefined) return this.queue.length === 0
    const startedAt = Date.now()
    if (!(await this.awaitReady(timeoutMs))) return false
    this.sendQueued()
    try {
      await this.request({ type: 'flush', id: 0 }, 'flushed', Math.max(1, timeoutMs - (Date.now() - startedAt)))
      return true
    } catch {
      return false
    }
  }

  async status(timeoutMs = this.options.queryTimeoutMs): Promise<DataStoreStatus> {
    const reply = await this.query({ type: 'status', id: 0 }, 'status', timeoutMs)
    if (reply.type !== 'status') throw new Error('Unexpected data store reply')
    return reply.status
  }

  async overview(input: UsageOverviewInput): Promise<UsageOverview> {
    const reply = await this.query({ type: 'overview', id: 0, input }, 'overview', this.options.queryTimeoutMs)
    if (reply.type !== 'overview') throw new Error('Unexpected data store reply')
    return reply.overview
  }

  async auditPage(input: AuditPageInput): Promise<AuditPage> {
    const reply = await this.query({ type: 'auditPage', id: 0, input }, 'auditPage', this.options.queryTimeoutMs)
    if (reply.type !== 'auditPage') throw new Error('Unexpected data store reply')
    return reply.page
  }

  private async query(
    message: Extract<MainToWorkerMessage, { id: number }>,
    expected: WorkerToMainMessage['type'],
    timeoutMs: number,
  ): Promise<WorkerToMainMessage> {
    const startedAt = Date.now()
    if (!(await this.awaitReady(timeoutMs))) throw new Error('Data store worker is not running')
    return await this.request(message, expected, Math.max(1, timeoutMs - (Date.now() - startedAt)))
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    const worker = this.worker
    if (worker === undefined) {
      this.settleReadyWaiters(false)
      return
    }
    await this.flush()
    this.settleReadyWaiters(false)
    try {
      await this.request({ type: 'close' }, 'closed', this.options.flushTimeoutMs)
    } catch {
      // Falling through to terminate is the whole point of the timeout.
    }
    this.rejectPending(new Error('Data store closed'))
    await worker.terminate()
    this.worker = undefined
    this.ready = false
  }

  private spawn(): void {
    const init: DataWorkerInit = {
      dbPath: this.options.dbPath,
      retention: this.options.retention,
      pruneIntervalMs: this.options.pruneIntervalMs,
    }
    const worker = new Worker(workerEntry(), {
      workerData: init,
      ...(workerEntryIsTypeScript() ? { execArgv: ['--import', 'tsx'] } : {}),
    })
    this.worker = worker
    worker.on('message', (message: WorkerToMainMessage) => {
      this.onMessage(message)
    })
    worker.on('error', (error) => {
      this.logger.error(`data store: worker error: ${describe(error)}`)
    })
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.worker = undefined
      this.ready = false
      this.rejectPending(new Error(`Data store worker exited with code ${code}`))
      if (this.closing) return
      this.logger.error(`data store: worker exited with code ${code}; ${this.queue.length} record(s) queued`)
      this.scheduleRestart()
    })
  }

  private scheduleRestart(): void {
    if (this.closing || this.restartTimer !== undefined) return
    const backoff = this.options.restartBackoffMs
    const delay = backoff[Math.min(this.restartAttempts, backoff.length - 1)] ?? 0
    this.restartAttempts += 1
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      this.start()
    }, delay)
    this.restartTimer.unref()
  }

  // Resolves true once the current worker has reported ready, false if there
  // is no worker or it did not come up within the timeout.
  private awaitReady(timeoutMs: number): Promise<boolean> {
    if (this.ready) return Promise.resolve(true)
    if (this.worker === undefined) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.readyWaiters.delete(waiter)
        resolve(false)
      }, timeoutMs)
      const waiter = (ready: boolean): void => {
        clearTimeout(timer)
        resolve(ready)
      }
      this.readyWaiters.add(waiter)
    })
  }

  private settleReadyWaiters(ready: boolean): void {
    for (const waiter of this.readyWaiters) waiter(ready)
    this.readyWaiters.clear()
  }

  private onMessage(message: WorkerToMainMessage): void {
    switch (message.type) {
      case 'ready':
        this.ready = true
        this.restartAttempts = 0
        this.settleReadyWaiters(true)
        this.scheduleSend()
        return
      case 'log':
        this.logger[message.level](message.message)
        return
      case 'flushed':
      case 'status':
      case 'overview':
      case 'auditPage':
      case 'failed':
        this.settle(message.id, message)
        return
      case 'closed':
        this.settle(0, message)
    }
  }

  private scheduleSend(): void {
    if (this.sendScheduled || !this.ready || this.queue.length === 0) return
    this.sendScheduled = true
    setImmediate(() => {
      this.sendScheduled = false
      this.sendQueued()
    })
  }

  private sendQueued(): void {
    const worker = this.worker
    if (worker === undefined || !this.ready) return
    while (this.queue.length > 0) {
      const records = this.queue.splice(0, MAX_RECORDS_PER_MESSAGE)
      try {
        worker.postMessage({ type: 'write', records } satisfies MainToWorkerMessage)
      } catch {
        // One record that cannot be structured-cloned must not take the batch
        // down with it: retry individually and drop only the offender.
        for (const record of records) {
          try {
            worker.postMessage({ type: 'write', records: [record] } satisfies MainToWorkerMessage)
          } catch (error) {
            this.droppedCount += 1
            this.logger.warn(`data store: dropped unserializable ${record.kind} record: ${describe(error)}`)
          }
        }
      }
    }
  }

  private request(
    message: MainToWorkerMessage,
    expected: WorkerToMainMessage['type'],
    timeoutMs: number,
  ): Promise<WorkerToMainMessage> {
    const worker = this.worker
    if (worker === undefined || !this.ready) {
      return Promise.reject(new Error('Data store worker is not running'))
    }
    const id = 'id' in message ? this.nextRequestId++ : 0
    const outgoing: MainToWorkerMessage = 'id' in message ? { ...message, id } : message
    return new Promise<WorkerToMainMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Data store did not answer '${expected}' within ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      worker.postMessage(outgoing)
    })
  }

  private settle(id: number, message: WorkerToMainMessage): void {
    const entry = this.pending.get(id)
    if (entry === undefined) return
    this.pending.delete(id)
    clearTimeout(entry.timer)
    if (message.type === 'failed') entry.reject(new Error(message.message))
    else entry.resolve(message)
  }

  private rejectPending(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }
}

function workerEntry(): URL {
  return new URL(workerEntryIsTypeScript() ? './data-worker.ts' : './data-worker.js', import.meta.url)
}

// Under tsx (dev) and vitest this module is loaded from source, so the worker
// must be too; tsx resolves the .js import specifiers back to .ts files.
function workerEntryIsTypeScript(): boolean {
  return import.meta.url.endsWith('.ts')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function consoleLogger(): DataStoreLogger {
  return {
    info: (message) => { console.info(message) },
    warn: (message) => { console.warn(message) },
    error: (message) => { console.error(message) },
  }
}
