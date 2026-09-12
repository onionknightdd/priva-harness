import type { DataRecorder } from '../../src/core/contract/data-recorder.js'
import type { DataRecord } from '../../src/core/resource/data-store.js'

export class MemoryDataRecorder implements DataRecorder {
  readonly records: DataRecord[] = []

  record(record: DataRecord): void {
    this.records.push(record)
  }

  ofKind<K extends DataRecord['kind']>(kind: K): Extract<DataRecord, { kind: K }>[] {
    return this.records.filter((record): record is Extract<DataRecord, { kind: K }> => record.kind === kind)
  }
}
