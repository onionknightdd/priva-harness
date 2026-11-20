import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { resolveBuiltinPlugins, type BuiltinPlugin } from './builtin-plugins.js'

/** A plugin MCP server ready to start, in a form every provider can translate. */
export interface PluginMcpServer {
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  /** Tools kept from the model, including the turn-end tool. */
  readonly hiddenTools: readonly string[]
  readonly turnEndTool?: string
}

const runtimeManifest = z.object({ target: z.string() })

/**
 * A plugin ships one runtime directory per platform under mcp/runtime. A missing
 * directory fails the session with the path to fill, instead of starting a
 * session whose tools silently do not exist.
 */
function runtimeDir(plugin: BuiltinPlugin): string {
  const target = `${process.platform}-${process.arch}`
  const directory = path.join(plugin.rootDir, 'mcp', 'runtime', target)
  let manifest: z.infer<typeof runtimeManifest>
  try {
    manifest = runtimeManifest.parse(JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')))
  } catch {
    throw new Error(`Plugin ${plugin.id} has no ${target} runtime. Install one at ${directory}`)
  }
  if (manifest.target !== target) {
    throw new Error(`Plugin ${plugin.id} runtime at ${directory} targets ${manifest.target}; this Runner needs ${target}`)
  }
  return directory
}

/** A Runner module runs on the Runner's own Node: from source through tsx, from the build directly. */
function runnerModuleLaunch(module: string): { command: string; args: string[] } {
  const source = import.meta.url.endsWith('.ts')
  const entry = fileURLToPath(new URL(`../../${module}.${source ? 'ts' : 'js'}`, import.meta.url))
  return { command: process.execPath, args: [...(source ? ['--import', createRequire(import.meta.url).resolve('tsx')] : []), entry] }
}

export function resolvePluginMcpServers(
  plugins: readonly BuiltinPlugin[], env: NodeJS.ProcessEnv = process.env,
): PluginMcpServer[] {
  const servers: PluginMcpServer[] = []
  for (const plugin of plugins) {
    let runtime: string | undefined
    // ${plugin} is the plugin directory, ${runtime} its runtime for this platform.
    const expand = (value: string): string => value.replace(/\$\{([^}]*)\}/gu, (_match, name: string) => {
      if (name === 'plugin') return plugin.rootDir
      if (name === 'runtime') return runtime ??= runtimeDir(plugin)
      throw new Error(`Plugin ${plugin.id} uses an unknown placeholder: \${${name}}`)
    })
    for (const [name, declaration] of Object.entries(plugin.mcpServers)) {
      if (servers.some((server) => server.name === name)) throw new Error(`MCP server ${name} is declared by more than one plugin`)
      const inherited = declaration.inheritEnv.flatMap((key) => {
        const value = env[key]
        return value ? [[key, value] as const] : []
      })
      const launch = declaration.runnerModule !== undefined ? runnerModuleLaunch(declaration.runnerModule)
        : { command: expand(declaration.command ?? ''), args: [] }
      servers.push({
        name,
        command: launch.command,
        args: [...launch.args, ...declaration.args.map(expand)],
        env: {
          ...Object.fromEntries(inherited),
          ...Object.fromEntries(Object.entries(declaration.env).map(([key, value]) => [key, expand(value)])),
        },
        hiddenTools: [...new Set([...declaration.hiddenTools, ...(declaration.turnEndTool ? [declaration.turnEndTool] : [])])],
        ...(declaration.turnEndTool ? { turnEndTool: declaration.turnEndTool } : {}),
      })
    }
  }
  return servers
}

/** MCP servers of the plugins a session enabled. */
export function enabledPluginMcpServers(ids: readonly string[]): PluginMcpServer[] {
  return resolvePluginMcpServers(resolveBuiltinPlugins(ids))
}
