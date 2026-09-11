import type { DataRecord } from '../resource/data-store.js'

// Fire-and-forget sink for usage and audit records. Implementations must
// never throw and must never block the caller: recording is observability,
// not part of the business flow.
export interface DataRecorder {
  record(record: DataRecord): void
}
