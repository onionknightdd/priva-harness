import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import stripJsonComments from 'strip-json-comments'
import { computerMcpServers } from '../src/core/plugin/computer-use.ts'

const desktopEnvironmentKeys = [
  'DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR',
  'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE',
]

/** Seed native provider resources before the Runner or its agents start. */
export async function configureComputer(env = process.env) {
  const claudeDir = requiredDirectory(env, 'CLAUDE_CONFIG_DIR')
  const piDir = requiredDirectory(env, 'PI_CODING_AGENT_DIR')
  const surfaces = env.PRIVA_CUA_RUNTIME ? computerMcpServers([], env).cua_repl.env.CUA_REPL_ENABLED_SURFACES : ''
  const unified = surfaces.split(',').includes('computer')
  const desktopEnv = Object.fromEntries(desktopEnvironmentKeys.map((key) => [key, unified ? env[key] : requiredValue(env, key)]))
  const command = { command: '/usr/local/bin/cua-driver', args: ['mcp', '--direct'], env: desktopEnv }
  const skill = await readFile(new URL('./skills/computer-desktop/SKILL.md', import.meta.url), 'utf8')
  const plans = await Promise.all([
    planMcp(join(claudeDir, '.claude.json'), { ...command, type: 'stdio', alwaysLoad: true }, unified),
    planMcp(join(piDir, 'mcp.json'), { ...command, exposure: 'codemode' }, unified, true),
    ...[claudeDir, piDir].map((directory) => planSkill(directory, skill, unified)),
  ])

  // Validate both providers before writing either, so malformed user JSON is never replaced.
  for (const plan of plans) {
    if (plan.warning) console.warn(plan.warning)
    if (plan.content !== undefined) await atomicWrite(plan.path, plan.content)
    if (plan.remove) await rm(plan.path, { force: true })
  }
}

function requiredValue(env, key) {
  const value = env[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} is required to configure the desktop MCP`)
  return value
}

function requiredDirectory(env, key) {
  const value = requiredValue(env, key)
  if (!isAbsolute(value)) throw new Error(`${key} must be an absolute directory`)
  return value
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function regularFile(path) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 5 * 1024 * 1024) {
      throw new Error(`Expected a regular configuration file of at most 5 MiB: ${path}`)
    }
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function planSkill(directory, template, unified) {
  const parent = join(directory, 'skills')
  const resource = join(parent, 'computer-desktop')
  const path = join(resource, 'SKILL.md')
  if (!unified) return await regularFile(path) ? { path } : { path, content: template }

  // Preserve linked or extended user skills, including their entry document.
  try {
    for (const dir of [parent, resource]) {
      if (!(await lstat(dir)).isDirectory()) return { path, warning: `Keeping linked or customized skill directory: ${dir}` }
    }
    const files = await readdir(resource)
    if (!files.includes('SKILL.md')) return { path }
    const info = await lstat(path)
    if (files.length !== 1 || !info.isFile() || info.size > 5 * 1024 * 1024) return { path, warning: `Keeping customized desktop skill: ${path}` }
  } catch (error) {
    if (error.code === 'ENOENT') return { path }
    throw error
  }
  const bytes = await readFile(path)
  // Exact UTF-8 bytes shipped before the Pi codemode instructions changed.
  const oldTemplate = '102163c91efe120c98f04670ad4c8945b41d3e5ef38a82544abff5a127db1a6a'
  if (bytes.equals(Buffer.from(template)) || createHash('sha256').update(bytes).digest('hex') === oldTemplate) {
    return { path, remove: true }
  }
  return { path, warning: `Keeping customized desktop skill: ${path}` }
}

async function planMcp(path, definition, unified, pi = false) {
  let config = {}
  let keepSource = false
  if (await regularFile(path)) {
    try {
      const content = await readFile(path, 'utf8')
      const parsed = pi ? content : stripJsonComments(content, { trailingCommas: true })
      config = JSON.parse(parsed)
      // Rewriting JSONC, duplicate keys, or a rounded number could discard a user's settings.
      if (unified) {
        const compact = content.replace(/"(?:\\.|[^"\\])*"|\s+/gu, (token) => token.startsWith('"') ? token : '')
        keepSource = parsed !== content || compact !== JSON.stringify(config)
      }
    }
    catch { throw new Error(`Invalid JSON in desktop MCP configuration: ${path}`) }
  }
  if (!isRecord(config)) throw new Error(`Expected a JSON object in desktop MCP configuration: ${path}`)
  if (pi && ['mcp-servers', 'settings', 'imports'].some((key) => Object.hasOwn(config, key))) {
    if (unified) return { path, warning: `Keeping user-managed legacy Pi MCP configuration: ${path}` }
    throw new Error(`Legacy Pi adapter configuration in desktop MCP file ${path}; reconfigure using native mcpServers before starting`)
  }
  const key = 'mcpServers'
  const servers = config[key] === undefined ? {} : config[key]
  if (!isRecord(servers) || Object.values(servers).some((value) => !isRecord(value))) {
    throw new Error(`Expected an MCP server dictionary in ${path}`)
  }
  if (unified) {
    if (!Object.hasOwn(servers, 'computer')) return { path }
    const { command, args, env } = definition
    const managed = isDeepStrictEqual(servers.computer, definition)
      || (pi && isDeepStrictEqual(servers.computer, { command, args, env, lifecycle: 'eager' }))
    if (!managed || keepSource) return { path, warning: `Keeping user-managed desktop MCP configuration: ${path} (computer)` }
    delete servers.computer
    return { path, content: `${JSON.stringify(config, null, 2)}\n` }
  }
  if (pi) for (const [name, server] of Object.entries(servers)) {
    const legacy = ['disabled', 'includeTools', 'excludeTools', 'toolPrefix', 'httpTransport', 'socket', 'lifecycle', 'inheritEnv', 'bearerToken', 'bearerTokenEnv', 'bearerTokenStore', 'requestHeadersCommand', 'headersHelper', 'authProvider', 'connectionTimeout'].filter((key) => Object.hasOwn(server, key))
    if (legacy.length) throw new Error(`Legacy Pi adapter fields (${legacy.join(', ')}) for ${name} in desktop MCP file ${path}; reconfigure the server using native Pi settings`)
  }
  // User overrides and disabled entries own this name, including on subsequent starts.
  if (Object.hasOwn(servers, 'computer')) return { path }
  config[key] = { ...servers, computer: definition }
  return { path, content: `${JSON.stringify(config, null, 2)}\n` }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await configureComputer() }
  catch (error) {
    process.stderr.write(`${fileURLToPath(import.meta.url)}: ${error.message}\n`)
    process.exitCode = 1
  }
}
