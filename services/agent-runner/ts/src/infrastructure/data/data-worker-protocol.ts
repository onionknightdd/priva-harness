import type { DataRecord, DataRetention, DataStoreStatus } from '../../core/resource/data-store.js'
import type { AuditPage, AuditPageInput, UsageOverview, UsageOverviewInput } from '../../core/resource/usage-overview.js'

export interface DataWorkerInit {
  readonly dbPath: string
  readonly retention: DataRetention
  readonly pruneIntervalMs: number
}

export type MainToWorkerMessage =
  | { readonly type: 'write'; readonly records: readonly DataRecord[] }
  | { readonly type: 'flush'; readonly id: number }
  | { readonly type: 'status'; readonly id: number }
  | { readonly type: 'overview'; readonly id: number; readonly input: UsageOverviewInput }
  | { readonly type: 'auditPage'; readonly id: number; readonly input: AuditPageInput }
  | { readonly type: 'close' }

export type WorkerToMainMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'flushed'; readonly id: number }
  | { readonly type: 'status'; readonly id: number; readonly status: DataStoreStatus }
  | { readonly type: 'overview'; readonly id: number; readonly overview: UsageOverview }
  | { readonly type: 'auditPage'; readonly id: number; readonly page: AuditPage }
  | { readonly type: 'failed'; readonly id: number; readonly message: string }
  | { readonly type: 'log'; readonly level: 'info' | 'warn' | 'error'; readonly message: string }
  | { readonly type: 'closed' }
