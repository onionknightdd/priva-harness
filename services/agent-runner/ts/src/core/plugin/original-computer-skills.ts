import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, join, posix } from 'node:path'
import { z } from 'zod'

export const originalComputerSkills = {
  browser: 'control-in-app-browser', chrome: 'control-chrome', 'computer-use': 'computer-use',
  'computer-history': 'computer-history', 'record-and-replay': 'record-and-replay',
} as const

export type OriginalComputerPluginId = keyof typeof originalComputerSkills
export const originalPluginIds = Object.keys(originalComputerSkills) as OriginalComputerPluginId[]
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const entrySchema = z.object({
  id: z.enum(originalPluginIds), version: z.string().min(1), license: z.string().min(1),
  skillPlatform: z.enum(['darwin', 'linux']).optional(),
  manifestSha256: digest, files: z.record(z.string(), digest), requires: z.array(z.string()),
  outsideStage: z.array(z.string()), mcpServers: z.array(z.string()), hooks: z.array(z.string()),
  mcpManifestSha256: digest.optional(),
})
export const inventorySchema = z.object({ version: z.literal(1), plugins: z.array(entrySchema) })
export type OriginalSkillEntry = z.infer<typeof entrySchema>

export function fileHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Resolve only ordinary bundle files; reject symbolic links even inside a declared resource tree. */
export function bundleFile(root: string, relative: string): Buffer {
  if (!relative || posix.normalize(relative) !== relative || relative.startsWith('/') || relative.startsWith('..') || relative.includes('\\')) {
    throw new Error(`Invalid plugin-relative path: ${relative}`)
  }
  let path = root
  const parts = relative.split('/')
  for (const [i, part] of parts.entries()) {
    path = join(path, part)
    const info = lstatSync(path)
    if (i < parts.length - 1 ? !info.isDirectory() : !info.isFile() || info.size > 8 * 1024 * 1024) {
      throw new Error(`Expected an ordinary plugin resource: ${relative}`)
    }
  }
  return readFileSync(path)
}

export function resolveOriginalComputerSkills(root: string, ids: readonly string[], runtimePlatform?: NodeJS.Platform) {
  if (!isAbsolute(root)) throw new Error('PRIVA_CUA_SKILLS must point to an absolute directory')
  const info = lstatSync(root)
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new Error('Original skill staging root must be a private directory')
  const inventory = inventorySchema.parse(JSON.parse(bundleFile(root, 'inventory.json').toString()))
  return [...new Set(ids)].map((id) => {
    const plugin = inventory.plugins.find((entry) => entry.id === id)
    if (!plugin) throw new Error(`Original skill not present in staged inventory: ${id}`)
    if (id === 'computer-use' && runtimePlatform && plugin.skillPlatform !== runtimePlatform) {
      throw new Error(`The local ${runtimePlatform} node_repl needs a matching computer-use SKILL.md; the snapshot declares ${plugin.skillPlatform ?? 'no platform'}. Stage the skills from the matching platform package.`)
    }
    const rel = `skills/${originalComputerSkills[plugin.id]}`
    for (const required of [rel + '/SKILL.md', '.claude-plugin/plugin.json',
      ...(['browser', 'chrome'].includes(id) ? ['scripts/browser-client.mjs', 'docs/api.json', 'docs/documents.json'] : [])]) {
      if (!plugin.files[required]) throw new Error(`Missing staged inventory entry: ${id}/${required}`)
    }
    for (const [path, sha256] of Object.entries(plugin.files)) {
      if (fileHash(bundleFile(root, `${id}/${path}`)) !== sha256) throw new Error(`Original skill SHA-256 mismatch: ${id}/${path}`)
    }
    return { id: plugin.id, pluginRoot: join(root, id), skillDir: join(root, id, rel) }
  })
}
