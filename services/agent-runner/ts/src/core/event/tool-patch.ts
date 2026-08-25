import { asRecord, numberField, stringField, type JsonRecord } from './json-record.js'

/** Convert Claude FileEditOutput / FileWriteOutput hunks into unified diff. */
export function unifiedDiffFromStructuredPatch(value: unknown): string {
  const hunks = structuredPatchHunks(value)
  if (hunks.length === 0) {
    return ''
  }
  const parts: string[] = []
  for (const hunk of hunks) {
    parts.push(
      `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`,
    )
    parts.push(...hunk.lines)
  }
  return parts.join('\n')
}

/** Prefer Pi `details.patch`; accept `details.diff` only when it is unified. */
export function patchFromToolDetails(value: unknown): string {
  const record = asRecord(value)
  if (record === undefined) {
    return ''
  }
  const details = asRecord(record['details']) ?? record
  const patch = stringField(details, 'patch')
  if (patch !== undefined && patch !== '') {
    return patch
  }
  const diff = stringField(details, 'diff')
  if (diff !== undefined && /^(?:diff --git |--- |\+\+\+ |@@ )/m.test(diff)) {
    return diff
  }
  return ''
}

function structuredPatchHunks(
  value: unknown,
): {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}[] {
  const raw = Array.isArray(value)
    ? value
    : asRecord(value)?.['structuredPatch']
  if (!Array.isArray(raw)) {
    return []
  }
  const hunks: {
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    lines: string[]
  }[] = []
  for (const item of raw) {
    const record = asRecord(item)
    if (record === undefined) {
      continue
    }
    const parsed = hunkFromRecord(record)
    if (parsed !== undefined) {
      hunks.push(parsed)
    }
  }
  return hunks
}

function hunkFromRecord(record: JsonRecord): {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
} | undefined {
  const oldStart = numberField(record, 'oldStart')
  const newStart = numberField(record, 'newStart')
  const rawLines = record['lines']
  if (oldStart === undefined || newStart === undefined || !Array.isArray(rawLines)) {
    return undefined
  }
  const lines = rawLines.filter((line): line is string => typeof line === 'string')
  const oldLines = numberField(record, 'oldLines') ?? countHunkLines(lines, 'old')
  const newLines = numberField(record, 'newLines') ?? countHunkLines(lines, 'new')
  return { oldStart, oldLines, newStart, newLines, lines }
}

function countHunkLines(lines: readonly string[], side: 'old' | 'new'): number {
  let count = 0
  for (const line of lines) {
    if (line.startsWith('\\')) {
      continue
    }
    if (side === 'old' && line.startsWith('+')) {
      continue
    }
    if (side === 'new' && line.startsWith('-')) {
      continue
    }
    count += 1
  }
  return count
}
