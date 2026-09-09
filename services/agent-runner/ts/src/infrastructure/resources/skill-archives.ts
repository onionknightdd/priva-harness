import { readFile } from 'node:fs/promises'
import { basename, posix } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

import { unzipSync, zipSync } from 'fflate'
import tar from 'tar-stream'

import { ResourceError, type SkillDetail } from '../../core/resource/resource-catalog.js'
import { containedFile } from './resource-files.js'

export const MAX_SKILL_ARCHIVE_BYTES = 3 * 1024 * 1024
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024
const MAX_ENTRY_BYTES = 5 * 1024 * 1024
const MAX_ENTRIES = 2000

function isArchiveMetadata(path: string): boolean {
  return path.split('/').some((part) => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'))
}

function archivePath(path: string): string {
  if (path.includes('\0') || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/u.test(path) || path.split('/').includes('..')) throw new ResourceError(422, 'Archive contains an unsafe path')
  const normalized = posix.normalize(path).replace(/^\.\//u, '')
  if (normalized === '.' || (normalized.startsWith('.') && !isArchiveMetadata(normalized))) throw new ResourceError(422, 'Archive contains an invalid path')
  return normalized
}

export async function readSkillArchive(filename: string, data: Buffer): Promise<Map<string, Uint8Array>> {
  if (data.length > MAX_SKILL_ARCHIVE_BYTES) throw new ResourceError(413, 'Skill archives must be 3 MB or smaller')
  let count = 0
  let expanded = 0
  const seen = new Set<string>()
  const entries = new Map<string, Uint8Array>()
  const check = (name: string, size: number) => {
    const path = archivePath(name)
    count++
    expanded += size
    if (count > MAX_ENTRIES || size > MAX_ENTRY_BYTES || expanded > MAX_EXPANDED_BYTES || expanded > Math.max(data.length, 1) * 200) throw new ResourceError(413, 'Skill archive exceeds extraction limits')
    if (seen.has(path)) throw new ResourceError(422, 'Archive contains duplicate paths')
    seen.add(path)
    return path
  }
  try {
    if (/\.(zip|skill)$/iu.test(filename)) {
      // Metadata still counts toward extraction limits and must have safe paths.
      const unzipped = unzipSync(data, { filter: (entry) => { const path = check(entry.name, entry.originalSize); return !entry.name.endsWith('/') && !isArchiveMetadata(path) } })
      for (const [name, value] of Object.entries(unzipped)) {
        if (value.length > MAX_ENTRY_BYTES) throw new ResourceError(413, 'Skill file exceeds extraction limits')
        entries.set(archivePath(name), value)
      }
    } else if (/\.(tar|tar\.gz|tgz)$/iu.test(filename)) {
      const extract = tar.extract()
      extract.on('entry', (header, stream, next) => {
        stream.on('error', (error) => extract.destroy(error))
        try {
          const path = check(header.name, header.size ?? 0)
          if (header.type !== 'file' && header.type !== 'directory') throw new ResourceError(422, 'Archive links and special files are not supported')
          const include = header.type === 'file' && !isArchiveMetadata(path)
          const chunks: Buffer[] = []
          let size = 0
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > MAX_ENTRY_BYTES || size > (header.size ?? 0)) extract.destroy(new ResourceError(413, 'Skill file exceeds extraction limits'))
            else if (include) chunks.push(chunk)
          })
          stream.on('end', () => { if (include) entries.set(path, Buffer.concat(chunks)); next() })
          stream.resume()
        } catch (error) { extract.destroy(error instanceof Error ? error : new Error('Invalid archive')) }
      })
      let decoded = 0
      const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        decoded += chunk.length
        callback(decoded > MAX_EXPANDED_BYTES + MAX_ENTRIES * 1024 ? new ResourceError(413, 'Skill archive exceeds extraction limits') : null, chunk)
      } })
      if (/\.(gz|tgz)$/iu.test(filename)) await pipeline(Readable.from([data]), createGunzip(), limit, extract)
      else await pipeline(Readable.from([data]), limit, extract)
    } else throw new ResourceError(415, 'Use a .zip, .skill, .tar, .tar.gz or .tgz archive')
  } catch (error) {
    if (error instanceof ResourceError) throw error
    throw new ResourceError(422, 'Archive is corrupt or has an unsupported format')
  }
  if (entries.size === 0) throw new ResourceError(422, 'Archive contains no skill files')
  return entries
}

export async function downloadSkillArchive(skill: SkillDetail): Promise<{ filename: string; data: Uint8Array }> {
  const entries: Record<string, Uint8Array> = {}
  let total = 0
  for (const file of skill.files) {
    total += file.size
    if (total > MAX_EXPANDED_BYTES || file.size > MAX_ENTRY_BYTES) throw new ResourceError(413, 'Skill is too large to archive')
    const data = await readFile(await containedFile(skill.path, file.path))
    if (data.length !== file.size) throw new ResourceError(409, 'Skill changed while downloading; retry')
    entries[`${basename(skill.path)}/${file.path}`] = data
  }
  return { filename: `${basename(skill.path)}.zip`, data: zipSync(entries, { level: 6 }) }
}
