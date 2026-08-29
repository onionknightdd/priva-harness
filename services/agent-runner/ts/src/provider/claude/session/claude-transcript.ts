import { asRecord, isRecord, stringField, type JsonRecord } from '../../../core/event/json-record.js'

export const EMPTY_TOOL_USE_RESULTS: ReadonlyMap<string, unknown> = new Map()

/**
 * Claude's JSONL transcript stores FileEditOutput / FileReadOutput on the
 * record root as `toolUseResult`. The Agent SDK `getSessionMessages` type
 * omits that field, so history replay only sees the success string unless we
 * copy it back before mapping.
 */
export function toolUseResultsFromTranscriptLines(
  lines: readonly string[],
): Map<string, unknown> {
  const results = new Map<string, unknown>()
  for (const line of lines) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      continue
    }
    const record = asRecord(parsed)
    if (record === undefined) continue
    const result = record['toolUseResult'] ?? record['tool_use_result']
    if (result === undefined || result === null) continue
    const uuid = nonEmpty(stringField(record, 'uuid'))
    if (uuid !== undefined) {
      results.set(uuidKey(uuid), result)
    }
    const toolUseId = firstToolResultId(record)
    if (toolUseId === undefined) continue
    const key = toolKey(toolUseId)
    if (isSidechain(record) && results.has(key)) continue
    results.set(key, result)
  }
  return results
}

export function transcriptThreadRecords(lines: readonly string[]): unknown[] {
  const records: unknown[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      continue
    }
    const record = asRecord(parsed)
    if (record === undefined || !isMainThreadRecord(record)) continue
    records.push(parsed)
  }
  return records
}

export function mergeSdkAndTranscriptMessages(
  sdkMessages: readonly unknown[],
  transcriptRecords: readonly unknown[],
): unknown[] {
  const sdkByUuid = new Map<string, unknown>()
  for (const raw of sdkMessages) {
    const uuid = recordUuid(raw)
    if (uuid !== undefined) sdkByUuid.set(uuid, raw)
  }

  const used = new Set<string>()
  const merged: unknown[] = []
  for (const record of transcriptRecords) {
    const uuid = recordUuid(record)
    if (uuid !== undefined && sdkByUuid.has(uuid)) {
      merged.push(sdkByUuid.get(uuid))
      used.add(uuid)
      continue
    }
    merged.push(record)
    if (uuid !== undefined) used.add(uuid)
  }
  for (const raw of sdkMessages) {
    const uuid = recordUuid(raw)
    if (uuid !== undefined && used.has(uuid)) continue
    if (isSyntheticNoResponseAssistant(raw)) continue
    merged.push(raw)
  }
  return merged
}

export function attachTranscriptToolUseResult(
  raw: unknown,
  results: ReadonlyMap<string, unknown>,
): unknown {
  if (results.size === 0 || !isRecord(raw)) return raw
  if (raw['tool_use_result'] !== undefined || raw['toolUseResult'] !== undefined) {
    return raw
  }
  const uuid = nonEmpty(stringField(raw, 'uuid')) ?? nonEmpty(stringField(raw, 'id'))
  const fromUuid = uuid === undefined ? undefined : results.get(uuidKey(uuid))
  const toolUseId = firstToolResultId(raw)
  const fromTool = toolUseId === undefined ? undefined : results.get(toolKey(toolUseId))
  const result = fromUuid ?? fromTool
  if (result === undefined) return raw
  return { ...raw, tool_use_result: result }
}

function firstToolResultId(record: JsonRecord): string | undefined {
  const message = asRecord(record['message']) ?? record
  const content = message['content']
  if (!Array.isArray(content)) return undefined
  for (const part of content) {
    const item = asRecord(part)
    if (item === undefined) continue
    if (stringField(item, 'type') !== 'tool_result') continue
    const id = nonEmpty(stringField(item, 'tool_use_id')) ?? nonEmpty(stringField(item, 'toolUseId'))
    if (id !== undefined) return id
  }
  return undefined
}

function isMainThreadRecord(record: JsonRecord): boolean {
  const type = stringField(record, 'type')
  if (type !== 'user' && type !== 'assistant') return false
  if (isSidechain(record)) return false
  if (record['isMeta'] === true) return false
  if (isSyntheticNoResponseAssistant(record)) return false
  return true
}

export function isSyntheticNoResponseAssistant(raw: unknown): boolean {
  const record = asRecord(raw)
  if (record === undefined) return false
  const type = stringField(record, 'type')
  if (type !== undefined && type !== 'assistant') return false
  const message = asRecord(record['message']) ?? record
  if (assistantText(message) !== 'No response requested.') return false
  return !hasToolUseBlocks(message)
}

function assistantText(message: JsonRecord): string {
  const content = message['content']
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      const item = asRecord(part)
      if (item === undefined) return ''
      if (stringField(item, 'type') !== 'text') return ''
      return stringField(item, 'text') ?? ''
    })
    .join('')
    .trim()
}

function hasToolUseBlocks(message: JsonRecord): boolean {
  const content = message['content']
  if (!Array.isArray(content)) return false
  return content.some((part) => {
    const item = asRecord(part)
    return item !== undefined && stringField(item, 'type') === 'tool_use'
  })
}

function recordUuid(raw: unknown): string | undefined {
  const record = asRecord(raw)
  if (record === undefined) return undefined
  return nonEmpty(stringField(record, 'uuid')) ?? nonEmpty(stringField(record, 'id'))
}

function isSidechain(record: JsonRecord): boolean {
  return record['isSidechain'] === true || record['is_sidechain'] === true
}

function uuidKey(uuid: string): string {
  return `uuid:${uuid}`
}

function toolKey(toolUseId: string): string {
  return `tool:${toolUseId}`
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}
