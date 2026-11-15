import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const pluginMetadataSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
  name: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().min(1),
}).strict()

export interface BuiltinPlugin {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon: string
  readonly rootDir: string
  readonly skillDir: string
}

// Source and compiled modules share the same relative resource layout.
const resourceRoot = fileURLToPath(new URL('../../resources/plugins/', import.meta.url))
const builtinPlugins: readonly BuiltinPlugin[] = readdirSync(resourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name))
  .map((entry) => {
    const rootDir = path.join(resourceRoot, entry.name)
    const raw: unknown = JSON.parse(readFileSync(path.join(rootDir, 'plugin.json'), 'utf8'))
    const metadata = pluginMetadataSchema.parse(raw)
    if (metadata.id !== entry.name) throw new Error(`Built-in plugin id must match its directory: ${entry.name}`)
    const skillDir = path.join(rootDir, 'skill')
    if (!statSync(path.join(skillDir, 'SKILL.md')).isFile()) throw new Error(`Built-in plugin ${metadata.id} is missing skill/SKILL.md`)
    return Object.freeze({ ...metadata, rootDir, skillDir })
  })

export const BUILTIN_PLUGIN_IDS: readonly string[] = Object.freeze(builtinPlugins.map((plugin) => plugin.id))

export function normalizeEnabledPluginIds(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((id: unknown) => typeof id !== 'string')) {
    throw new Error('enabledPluginIds must be an array of built-in plugin ids')
  }
  const ids = value as string[]
  for (const id of ids) {
    if (!BUILTIN_PLUGIN_IDS.includes(id)) throw new Error(`Unknown built-in plugin: ${id}`)
  }
  return [...new Set(ids)].sort()
}

export function resolveBuiltinPlugins(ids: readonly string[]): readonly BuiltinPlugin[] {
  return normalizeEnabledPluginIds(ids).map((id) => {
    const plugin = builtinPlugins.find((candidate) => candidate.id === id)
    if (plugin === undefined) throw new Error(`Unknown built-in plugin: ${id}`)
    return plugin
  })
}
