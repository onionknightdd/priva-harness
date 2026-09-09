import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import stripJsonComments from 'strip-json-comments'

import { ResourceError } from '../../core/resource/resource-catalog.js'

export function resourceId(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('base64url').slice(0, 32)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch (error) {
    if (missing(error)) return false
    throw error
  }
}

export async function canonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new ResourceError(422, 'cwd must be an absolute directory path')
  try {
    const canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) throw new ResourceError(422, 'cwd must be a directory')
    return canonical
  } catch (error) {
    if (missing(error)) throw new ResourceError(404, 'Project directory no longer exists')
    throw error
  }
}

export function inside(root: string, path: string): boolean {
  const part = relative(resolve(root), resolve(path))
  return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part))
}

export async function containedFile(root: string, path: string): Promise<string> {
  if (isAbsolute(path) || path.includes('\0')) throw new ResourceError(422, 'File path must be relative to the skill')
  const absolute = resolve(root, path)
  if (!inside(root, absolute)) throw new ResourceError(403, 'File path escapes the skill')
  const canonicalRoot = await realpath(root)
  let canonical: string
  try { canonical = await realpath(absolute) } catch (error) {
    if (missing(error)) throw new ResourceError(404, 'Skill file not found')
    throw error
  }
  if (!inside(canonicalRoot, canonical)) throw new ResourceError(403, 'File link escapes the skill')
  return canonical
}

export async function readText(path: string, maxBytes = 1024 * 1024): Promise<string> {
  const info = await stat(path)
  if (!info.isFile()) throw new ResourceError(422, 'Expected a regular file')
  if (info.size > maxBytes) throw new ResourceError(413, 'File is too large to preview')
  const data = await readFile(path)
  if (data.length > maxBytes) throw new ResourceError(413, 'File is too large to preview')
  if (data.includes(0)) throw new ResourceError(415, 'Binary files cannot be previewed')
  return data.toString('utf8')
}

// Cache parsed files, not merged configurations. Stat changes invalidate edits made outside the app.
export class ResourceFiles {
  private readonly cache = new Map<string, { stamp: string; value: Record<string, unknown> }>()
  private readonly writes = new Map<string, Promise<unknown>>()

  async json(path: string): Promise<Record<string, unknown>> {
    let info
    try { info = await stat(path, { bigint: true }) } catch (error) {
      if (missing(error)) { this.cache.delete(path); return {} }
      throw error
    }
    if (!info.isFile() || info.size > 5n * 1024n * 1024n) throw new ResourceError(422, `Invalid configuration file: ${path}`)
    const stamp = `${info.ino}:${info.mtimeNs}:${info.ctimeNs}:${info.size}`
    const cached = this.cache.get(path)
    if (cached?.stamp === stamp) return structuredClone(cached.value)
    let value: unknown
    try { value = JSON.parse(stripJsonComments(await readFile(path, 'utf8'), { trailingCommas: true })) } catch {
      throw new ResourceError(422, `Invalid JSON in ${path}`)
    }
    if (!isRecord(value)) throw new ResourceError(422, `Expected a JSON object in ${path}`)
    if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value ?? '')
    this.cache.set(path, { stamp, value })
    return structuredClone(value)
  }

  async update(path: string, edit: (value: Record<string, unknown>) => void): Promise<void> {
    const previous = this.writes.get(path) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(async () => {
      // Never replace a symlink with a new file or mutate a different target implicitly.
      try {
        if ((await lstat(path)).isSymbolicLink()) throw new ResourceError(403, 'Linked configuration files are read-only')
      } catch (error) { if (!missing(error)) throw error }
      this.cache.delete(path)
      const value = await this.json(path)
      edit(value)
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
        await rename(temp, path)
      } finally {
        this.cache.delete(path)
        await rm(temp, { force: true })
      }
    })
    this.writes.set(path, next)
    try { await next } finally { if (this.writes.get(path) === next) this.writes.delete(path) }
  }
}
