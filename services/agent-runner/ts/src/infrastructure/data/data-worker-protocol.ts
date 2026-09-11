import type { DataRecord, DataRetention, DataStoreStatus } from '../../core/resource/data-store.js'

export interface DataWorkerInit {
  readonly dbPath: string
  readonly retention: DataRetention
  readonly pruneIntervalMs: number
}

export type MainToWorkerMessage =
  | { readonly type: 'write'; readonly records: readonly DataRecord[] }
  | { readonly type: 'flush'; readonly id: number }
  | { readonly type: 'status'; readonly id: number }
  | { readonly type: 'close' }

export type WorkerToMainMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'flushed'; readonly id: number }
  | { readonly type: 'status'; readonly id: number; readonly status: DataStoreStatus }
  | { readonly type: 'failed'; readonly id: number; readonly message: string }
  | { readonly type: 'log'; readonly level: 'info' | 'warn' | 'error'; readonly message: string }
  | { readonly type: 'closed' }
