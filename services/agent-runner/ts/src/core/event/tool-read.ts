import { asRecord, isRecord, numberField, stringField, type JsonRecord } from './json-record.js'

/** Encode Claude FileReadOutput / Pi Read content as a tagged JSON view for the UI. */
export function encodeReadView(value: unknown): string {
  if (typeof value === 'string') {
    const stripped = stripCatN(value)
    return stringifyReadText(stripped.content, stripped.startLine)
  }
  const record = asRecord(value)
  if (record === undefined) {
    return ''
  }
  const fromFile = encodeClaudeFile(record)
  if (fromFile !== '') {
    return fromFile
  }
  const fromContent = encodeContentBlocks(record['content'] ?? record['file'])
  if (fromContent !== '') {
    return fromContent
  }
  const details = asRecord(record['details'])
  if (details !== undefined) {
    const nested = encodeClaudeFile(details)
    if (nested !== '') {
      return nested
    }
  }
  return ''
}

function encodeClaudeFile(record: JsonRecord): string {
  const type = stringField(record, 'type')
  const file = asRecord(record['file']) ?? record
  if (type === 'image') {
    const b64 =
      stringField(file, 'base64') ?? stringField(file, 'b64') ?? stringField(file, 'data')
    const mime = imageMime(
      stringField(file, 'type') ??
        stringField(file, 'mime') ??
        stringField(file, 'mimeType'),
    )
    if (b64 !== undefined && b64 !== '' && mime !== undefined) {
      const dimensions = asRecord(file['dimensions'])
      return stringifyReadImage(
        mime,
        b64,
        numberField(file, 'width') ??
          (dimensions === undefined ? undefined : numberField(dimensions, 'displayWidth')),
        numberField(file, 'height') ??
          (dimensions === undefined ? undefined : numberField(dimensions, 'displayHeight')),
      )
    }
  }
  if (type === 'text') {
    const content = stringField(file, 'content')
    if (content !== undefined) {
      return stringifyReadText(content, numberField(file, 'startLine') ?? 1)
    }
  }
  if (type === 'notebook') {
    const cells = file['cells']
    return stringifyReadText(JSON.stringify(cells ?? [], null, 2), 1)
  }
  return ''
}

function encodeContentBlocks(value: unknown): string {
  if (typeof value === 'string') {
    const stripped = stripCatN(value)
    return stringifyReadText(stripped.content, stripped.startLine)
  }
  if (!Array.isArray(value)) {
    return ''
  }
  for (const item of value) {
    const block = asRecord(item)
    if (block === undefined) {
      continue
    }
    const type = stringField(block, 'type')
    if (type !== 'image') {
      continue
    }
    const source = asRecord(block['source']) ?? block
    const b64 =
      stringField(source, 'data') ??
      stringField(source, 'b64') ??
      stringField(block, 'data')
    const mime = imageMime(
      stringField(source, 'media_type') ??
        stringField(source, 'mediaType') ??
        stringField(source, 'mimeType') ??
        stringField(block, 'mimeType') ??
        stringField(block, 'mime'),
    )
    if (b64 !== undefined && b64 !== '' && mime !== undefined) {
      return stringifyReadImage(mime, b64)
    }
  }
  const text = value
    .filter(isRecord)
    .map((block) => stringField(block, 'text') ?? '')
    .join('')
  if (text === '') {
    return ''
  }
  const stripped = stripCatN(text)
  return stringifyReadText(stripped.content, stripped.startLine)
}

function stringifyReadText(content: string, startLine: number): string {
  return JSON.stringify({ $read: 'text', content, startLine })
}

function stringifyReadImage(
  mime: string,
  b64: string,
  width?: number,
  height?: number,
): string {
  return JSON.stringify({
    $read: 'image',
    mime,
    b64,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  })
}

function imageMime(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return 'image/png'
  }
  const value = raw.trim().toLowerCase()
  if (value === '' || value.startsWith('application/')) {
    return undefined
  }
  if (value.startsWith('image/')) {
    return value
  }
  if (value === 'jpg' || value === 'jpeg') {
    return 'image/jpeg'
  }
  if (value === 'png' || value === 'gif' || value === 'webp' || value === 'bmp') {
    return `image/${value}`
  }
  if (value === 'svg') {
    return 'image/svg+xml'
  }
  return `image/${value}`
}

function stripCatN(text: string): { content: string; startLine: number } {
  const lines = text.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  const parsed: { n: number; text: string }[] = []
  for (const raw of lines) {
    const match = /^[ \t]*(\d+)\t(.*)$/.exec(raw)
    if (match?.[1] === undefined) {
      return { content: text, startLine: 1 }
    }
    parsed.push({ n: Number(match[1]), text: match[2] ?? '' })
  }
  if (parsed.length === 0) {
    return { content: text, startLine: 1 }
  }
  return {
    content: parsed.map((line) => line.text).join('\n'),
    startLine: parsed[0]?.n ?? 1,
  }
}
