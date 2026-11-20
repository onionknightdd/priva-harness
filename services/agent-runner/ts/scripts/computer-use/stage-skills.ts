import { accessSync, constants, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
  bundleFile, fileHash, inventorySchema, originalComputerSkills, originalPluginIds, resolveOriginalComputerSkills,
  type OriginalComputerPluginId, type OriginalSkillEntry,
} from '../../src/core/plugin/original-computer-skills.js'
import { stageLinuxComputerSkill } from './stage-linux-sky-skill.js'

const manifestSchema = z.object({
  name: z.string(), version: z.string().min(1), license: z.string().min(1), skills: z.literal('./skills/'),
  hooks: z.object({ hooks: z.record(z.string(), z.unknown()) }).optional(), mcpServers: z.literal('./.mcp.json').optional(),
})
const mcpSchema = z.object({ mcpServers: z.record(z.string(), z.object({ command: z.string() })) })
const runtimeNeeds: Record<OriginalComputerPluginId, string[]> = {
  browser: ['node_repl.js', 'trusted browser service', 'connected in-app browser'],
  chrome: ['node_repl.js', 'trusted browser service', 'Chrome native messaging host and extension'],
  'computer-use': ['node_repl.js', '@oai/sky', '@oai/sky/service with a supported desktop'],
  'computer-history': ['computer-history MCP on authorized target'],
  'record-and-replay': ['event-stream MCP on authorized target'],
}

function save(root: string, name: string, bytes: Buffer): string {
  const path = join(root, name)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
  return fileHash(bytes)
}

function stageOne(source: string, destination: string, id: OriginalComputerPluginId): OriginalSkillEntry {
  const root = join(source, id)
  if (!lstatSync(root).isDirectory()) throw new Error(`Expected installed plugin directory: ${id}`)
  const manifestBytes = bundleFile(root, '.codex-plugin/plugin.json')
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString()))
  if (manifest.name !== id) throw new Error(`Installed plugin manifest disagrees with directory: ${id}`)
  const out = join(destination, id)
  const files: Record<string, string> = {}
  const excluded = new Set<string>()
  const skill = `skills/${originalComputerSkills[id]}`
  const expectedSkill = skill + '/SKILL.md'
  const browser = id === 'browser' || id === 'chrome'
  const decoder = new TextDecoder('utf-8', { fatal: true })
  function copy(relative: string) {
    const bytes = bundleFile(root, relative)
    if (extname(relative) === '.png') {
      if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error(`Invalid PNG: ${relative}`)
    } else {
      const text = decoder.decode(bytes)
      if (text.includes('\u0000')) throw new Error(`Expected a text asset: ${relative}`)
      if (relative === expectedSkill && !text.split(/\r?\n/u).includes('name: ' + originalComputerSkills[id])) {
        throw new Error(`Unexpected original skill name in ${id}/${relative}`)
      }
    }
    files[relative] = save(out, relative, bytes)
  }
  function copyTree(relative: string, allow: (path: string) => boolean) {
    if (!lstatSync(join(root, relative)).isDirectory()) throw new Error(`Expected a resource directory: ${relative}`)
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = relative + '/' + entry.name
      if (entry.isDirectory()) copyTree(path, allow)
      else if (entry.isFile() && allow(path)) copy(path)
      else throw new Error(`Unrecognized or linked asset in installed plugin ${id}: ${path}; review before staging`)
    }
  }
  copyTree('skills', (path) => path === expectedSkill || path === skill + '/agents/openai.yaml')
  if (!files[expectedSkill]) throw new Error(`Missing ${id}/${expectedSkill}`)
  copyTree('assets', (path) => /^assets\/[\w-]+\.(?:png|svg)$/u.test(path))
  if (browser) {
    copyTree('docs', (path) => /^docs\/(?:[\w-]+\/)*[\w-]+\.md$/u.test(path) || ['docs/api.json', 'docs/documents.json'].includes(path))
    copy('scripts/browser-client.mjs')
    for (const item of readdirSync(join(root, 'scripts'))) if (item !== 'browser-client.mjs') excluded.add('scripts/' + item)
  }
  for (const item of readdirSync(root)) {
    if (!['skills', 'assets', '.codex-plugin', ...(browser ? ['docs', 'scripts'] : [])].includes(item)) excluded.add(item)
  }
  const mcpBytes = manifest.mcpServers ? bundleFile(root, '.mcp.json') : undefined
  const mcp = mcpBytes ? mcpSchema.parse(JSON.parse(mcpBytes.toString())).mcpServers : {}
  for (const server of Object.values(mcp)) {
    // A launcher supplied by the original installation stays in its target-platform bundle.
    excluded.add(server.command)
  }
  const claude = { name: 'priva-original-' + id, skills: './' + skill }
  files['.claude-plugin/plugin.json'] = save(out, '.claude-plugin/plugin.json', Buffer.from(JSON.stringify(claude, null, 2) + '\n'))
  return {
    id, version: manifest.version, license: manifest.license, manifestSha256: fileHash(manifestBytes), files,
    ...(id === 'computer-use' ? { skillPlatform: 'darwin' as const } : {}),
    requires: runtimeNeeds[id], outsideStage: [...excluded].sort(), mcpServers: Object.keys(mcp),
    hooks: Object.keys(manifest.hooks?.hooks ?? {}), ...(mcpBytes ? { mcpManifestSha256: fileHash(mcpBytes) } : {}),
  }
}

const pluginIds = z.array(z.enum(originalPluginIds)).min(1, 'At least one original skill is required')
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate original skill ID')

export function verifyOriginalComputerSkills(root: string, expected?: readonly string[]) {
  const inventory = inventorySchema.parse(JSON.parse(bundleFile(root, 'inventory.json').toString()))
  const ids = pluginIds.parse(inventory.plugins.map((plugin) => plugin.id))
  if (expected && (ids.length !== expected.length || pluginIds.parse(expected).some((id) => !ids.includes(id)))) {
    throw new Error('Staged inventory differs from the requested original skills')
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'inventory.json' && entry.isFile()) continue
    if (!entry.isDirectory() || !ids.some((id) => id === entry.name)) throw new Error(`Unexpected staged resource: ${entry.name}`)
  }
  // The resolver verifies required paths and hashes. Also reject files omitted from the index.
  resolveOriginalComputerSkills(root, ids)
  for (const plugin of inventory.plugins) {
    function checkDirectory(relative: string) {
      for (const entry of readdirSync(join(root, plugin.id, relative), { withFileTypes: true })) {
        const path = relative ? relative + '/' + entry.name : entry.name
        if (entry.isDirectory()) checkDirectory(path)
        else if (!entry.isFile() || !Object.hasOwn(plugin.files, path)) throw new Error(`Unlisted staged resource: ${plugin.id}/${path}`)
      }
    }
    checkDirectory('')
  }
  return inventory.plugins
}

export function stageOriginalComputerSkills(source: string, destination: string, selection: readonly string[] = originalPluginIds, linuxRuntime?: string) {
  const ids = pluginIds.parse(selection)
  if (linuxRuntime && ids.includes('computer-use')) throw new Error('Choose a single source for the computer-use skill')
  if (!isAbsolute(source) || !isAbsolute(destination) || !lstatSync(source).isDirectory()) throw new Error('Provide absolute source and destination directories')
  if (resolve(destination) === resolve(source) || resolve(destination).startsWith(resolve(source) + sep)) throw new Error('Stage skills outside the installed source')
  // mkdir with exclusive creation also prevents replacing an earlier snapshot.
  mkdirSync(destination, { mode: 0o700 })
  try {
    const plugins = ids.map((id) => stageOne(source, destination, id))
    if (linuxRuntime) plugins.push(stageLinuxComputerSkill(linuxRuntime, destination))
    save(destination, 'inventory.json', Buffer.from(JSON.stringify({ version: 1, plugins }, null, 2) + '\n'))
    return verifyOriginalComputerSkills(destination, linuxRuntime ? [...ids, 'computer-use'] : ids)
  } catch (error) {
    rmSync(destination, { recursive: true, force: true })
    throw error
  }
}

/** Inspect an independently mounted original plugin without loading any of its code or MCP services. */
export function checkOriginalMount(stage: string, id: OriginalComputerPluginId, mountedPlugin: string) {
  resolveOriginalComputerSkills(stage, [id])
  if (!isAbsolute(mountedPlugin) || !lstatSync(mountedPlugin).isDirectory()) throw new Error('Expected an absolute mounted plugin directory')
  const manifest = manifestSchema.parse(JSON.parse(bundleFile(mountedPlugin, '.codex-plugin/plugin.json').toString()))
  const record = inventorySchema.parse(JSON.parse(bundleFile(stage, 'inventory.json').toString())).plugins.find((entry) => entry.id === id)
  if (!record || manifest.name !== id || manifest.version !== record.version) throw new Error('Mounted plugin ID/version differs from staged skills')
  const skill = `skills/${originalComputerSkills[id]}/SKILL.md`
  if (fileHash(bundleFile(mountedPlugin, skill)) !== record.files[skill]) throw new Error('Mounted and staged skill contents differ')
  const checked = [skill]
  if (id === 'browser' || id === 'chrome') {
    const bootstrap = 'scripts/browser-client.mjs'
    if (fileHash(bundleFile(mountedPlugin, bootstrap)) !== record.files[bootstrap]) throw new Error('Mounted browser bootstrap differs from staged copy')
    const required = [bootstrap, 'scripts/browser-service.mjs', 'scripts/browser-accessibility.wasm.br',
      'scripts/zxing_reader.wasm', 'node_modules/classic-level.mjs']
    for (const name of required) {
      if (!lstatSync(join(mountedPlugin, name)).isFile()) throw new Error(`Missing regular browser service resource: ${name}`)
      accessSync(join(mountedPlugin, name), constants.R_OK)
    }
    checked.push(...required)
  } else if (record.mcpManifestSha256) {
    const mcp = bundleFile(mountedPlugin, '.mcp.json')
    if (fileHash(mcp) !== record.mcpManifestSha256) throw new Error('Mounted MCP configuration differs from source manifest')
    for (const server of Object.values(mcpSchema.parse(JSON.parse(mcp.toString())).mcpServers)) {
      if (server.command !== './bin/computer-use-client-launcher') throw new Error('Unexpected local MCP launcher; review this installed version')
      accessSync(join(mountedPlugin, server.command), constants.X_OK)
    }
    if (process.platform !== 'darwin') throw new Error(`${id} requires its macOS application host; this target is ${process.platform}`)
    checked.push('.mcp.json', 'bin/computer-use-client-launcher')
  }
  return { id, checked, requiresLiveVerification: record.requires }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [mode, first, second, ...extra] = process.argv.slice(2)
  if (mode === 'check-mount' && first && second && extra.length === 1 && extra[0]) {
    console.log(JSON.stringify(checkOriginalMount(first, z.enum(originalPluginIds).parse(second), extra[0])))
  } else {
    let plugins
    if (mode === 'stage' && first && second) plugins = stageOriginalComputerSkills(first, second, extra.length ? extra : originalPluginIds)
    else if (mode === 'stage-linux' && first && second && extra.length === 1 && extra[0]) {
      plugins = stageOriginalComputerSkills(first, second, ['browser', 'chrome'], extra[0])
    }
    else if (mode === 'verify' && first) plugins = verifyOriginalComputerSkills(first, second ? [second, ...extra] : undefined)
    else throw new Error('Usage: stage-skills.ts stage INSTALLED_PLUGINS_ROOT NEW_PRIVATE_DIRECTORY [PLUGIN_ID...] | stage-linux INSTALLED_PLUGINS_ROOT NEW_PRIVATE_DIRECTORY RUNTIME | verify STAGED_ROOT [EXPECTED_PLUGIN_ID...] | check-mount STAGED_ROOT PLUGIN_ID MOUNTED_PLUGIN_ROOT')
    for (const plugin of plugins) console.log(`${plugin.id} ${plugin.version} ${Object.keys(plugin.files).length} files sha256:${plugin.manifestSha256}`)
  }
}
