import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { asRecord, stringField } from '../../../core/event/json-record.js'
import type { SessionMessage } from '../../../core/resource/session.js'
import type { UserAttachment } from '../../../core/run/user-turn.js'

/** A deterministic, disposable projection; the native transcript retains the bytes. */
export async function materializeClaudeImages(message: SessionMessage, directory: string): Promise<readonly UserAttachment[]> {
  if (message.type !== 'user' || message.parentToolUseId) return []
  const content = asRecord(message.message)?.['content']
  if (!Array.isArray(content)) return []
  const attachments: UserAttachment[] = []
  for (const block of content) {
    const image = asRecord(block)
    if (image?.['type'] !== 'image') continue
    const source = asRecord(image['source'])
    const data = stringField(source ?? {}, 'data'), mimeType = stringField(source ?? {}, 'media_type')
    const extension = mimeType ? ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[mimeType] : undefined
    if (source?.['type'] !== 'base64' || !data || !extension || !mimeType) continue
    const bytes = Buffer.from(data, 'base64')
    const name = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, name)
    try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    attachments.push({ path, name: `Image ${attachments.length + 1}.${basename(path).split('.').at(-1) ?? extension}`, mimeType, size: bytes.length })
  }
  return attachments
}
