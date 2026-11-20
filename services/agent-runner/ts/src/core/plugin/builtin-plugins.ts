import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const pluginMetadataSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
  name: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().min(1),
}).strict()

const toolName = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u)
const mcpServerSchema = z.strictObject({
  /** The program to start. A server that is part of the Runner names `runnerModule` instead. */
  command: z.string().min(1).optional(),
  /** A Runner module that is an MCP server, as a path under the Runner's source root without extension. */
  runnerModule: z.string().regex(/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)+$/u).optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  /** Runner environment variables forwarded to the server when they are set. */
  inheritEnv: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/u)).default([]),
  /** Tools the server provides for its host; they are never offered to the model. */
  hiddenTools: z.array(toolName).default([]),
  /** Tool the host calls when a turn or subagent stops. Always hidden from the model. */
  turnEndTool: toolName.optional(),
}).refine((server) => (server.command === undefined) !== (server.runnerModule === undefined), 'Declare exactly one of command and runnerModule')
const mcpManifestSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u), mcpServerSchema)

export type PluginMcpDeclaration = z.infer<typeof mcpServerSchema>

export interface BuiltinPlugin {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon: string
  readonly rootDir: string
  /** One directory per skill, each holding a SKILL.md. */
  readonly skillDirs: readonly string[]
  /** Declarations from mcp/servers.json, keyed by MCP server name. */
  readonly mcpServers: Readonly<Record<string, PluginMcpDeclaration>>
}

function readSkillDirs(id: string, rootDir: string): string[] {
  const skillsRoot = path.join(rootDir, 'skills')
  const skillDirs = !existsSync(skillsRoot) ? [] : readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsRoot, entry.name))
    .sort()
  if (skillDirs.length === 0) throw new Error(`Built-in plugin ${id} has no skills/<name>/SKILL.md`)
  for (const skillDir of skillDirs) {
    if (!statSync(path.join(skillDir, 'SKILL.md'), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Built-in plugin ${id} is missing ${path.relative(rootDir, skillDir)}/SKILL.md`)
    }
  }
  return skillDirs
}

function readMcpServers(rootDir: string): Record<string, PluginMcpDeclaration> {
  const manifest = path.join(rootDir, 'mcp', 'servers.json')
  if (!existsSync(manifest)) return {}
  const raw: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
  return mcpManifestSchema.parse(raw)
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
    return Object.freeze({
      ...metadata,
      rootDir,
      skillDirs: Object.freeze(readSkillDirs(metadata.id, rootDir)),
      mcpServers: Object.freeze(readMcpServers(rootDir)),
    })
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

/** The session's selection is the only thing that enables a plugin. */
export function resolveBuiltinPlugins(ids: readonly string[]): readonly BuiltinPlugin[] {
  return normalizeEnabledPluginIds(ids).map((id) => {
    const plugin = builtinPlugins.find((candidate) => candidate.id === id)
    if (plugin === undefined) throw new Error(`Unknown built-in plugin: ${id}`)
    return plugin
  })
}
