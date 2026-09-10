import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseDocument, stringify } from 'yaml'

import { ResourceError } from '../../core/resource/resource-catalog.js'
import { exists, isRecord, missing, readText, resourceId } from './resource-files.js'

export function parseMarkdown(content: string): { definition: Record<string, unknown>; prompt: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)
  if (!match) return { definition: {}, prompt: content }
  const document = parseDocument(match[1] ?? '', { uniqueKeys: true })
  if (document.errors[0]) throw new ResourceError(422, document.errors[0].message)
  const value: unknown = document.toJS({ maxAliasCount: 50 })
  if (!isRecord(value)) throw new ResourceError(422, 'Agent frontmatter must be a YAML object')
  return { definition: value, prompt: content.slice(match[0].length).trim() }
}

export function agentMarkdown(definition: Record<string, unknown>, prompt: string): string {
  return `---\n${stringify(definition, { lineWidth: 0 })}---\n\n${prompt.trim()}\n`
}

// One cache for raw content and parsed frontmatter; listing never opens a model session.
export class ResourceMarkdown {
  private readonly cache = new Map<string, { stamp: string; content: string; revision: string }>()
  private readonly writes = new Map<string, Promise<unknown>>()

  async read(path: string) {
    let info
    try { info = await stat(path, { bigint: true }) } catch (error) {
      if (missing(error)) return { content: '', revision: resourceId('missing'), exists: false, size: 0 }
      throw error
    }
    const stamp = `${info.ino}:${info.mtimeNs}:${info.ctimeNs}:${info.size}`
    let cached = this.cache.get(path)
    if (cached?.stamp !== stamp) {
      const content = await readText(path)
      cached = { stamp, content, revision: resourceId(content) }
      if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value ?? '')
      this.cache.set(path, cached)
    }
    return { content: cached.content, revision: cached.revision, exists: true, size: Number(info.size) }
  }

  async write(path: string, content: string, revision?: string): Promise<void> {
    if (Buffer.byteLength(content) > 1024 * 1024) throw new ResourceError(413, 'Content must be 1 MB or smaller')
    await this.mutate(path, revision, async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, content, { flag: 'wx', mode: 0o600 })
        if (revision === undefined) {
          // Exclusive creation also protects against external writers between discovery and save.
          try { await link(temp, path) } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new ResourceError(409, 'A file with this name already exists')
            throw error
          }
        } else await rename(temp, path)
      } finally { await rm(temp, { force: true }) }
    })
  }

  async delete(path: string, revision: string): Promise<void> {
    await this.mutate(path, revision, async () => { await rm(path) })
  }

  private async mutate(path: string, revision: string | undefined, action: () => Promise<void>): Promise<void> {
    const previous = this.writes.get(path) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(async () => {
      let current = path
      for (;;) {
        try { if ((await lstat(current)).isSymbolicLink()) throw new ResourceError(403, 'Linked files and directories are read-only') } catch (error) { if (!missing(error)) throw error }
        if (dirname(current) === current) break
        current = dirname(current)
      }
      if (revision !== undefined && (await this.read(path)).revision !== revision) throw new ResourceError(409, 'The file changed on disk. Reload before saving.')
      await action()
      this.cache.delete(path)
    })
    this.writes.set(path, next)
    try { await next } finally { if (this.writes.get(path) === next) this.writes.delete(path) }
  }
}

export async function markdownPaths(root: string, recursive = false): Promise<string[]> {
  try {
    const info = await stat(root)
    if (info.isFile()) return root.endsWith('.md') ? [root] : []
    const paths: string[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = join(root, entry.name)
      if (entry.name.endsWith('.md') && (entry.isFile() || entry.isSymbolicLink() && await exists(path) && (await stat(path)).isFile())) paths.push(path)
      else if (entry.isDirectory() && recursive) paths.push(...await markdownPaths(path, true))
    }
    return paths
  } catch (error) { if (missing(error)) return []; throw error }
}
