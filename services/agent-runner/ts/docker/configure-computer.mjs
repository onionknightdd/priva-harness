import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import stripJsonComments from 'strip-json-comments'

const desktopEnvironmentKeys = [
  'DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR',
  'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE',
]

/** Seed native provider resources before the Runner or its agents start. */
export async function configureComputer(env = process.env) {
  const claudeDir = requiredDirectory(env, 'CLAUDE_CONFIG_DIR')
  const piDir = requiredDirectory(env, 'PI_CODING_AGENT_DIR')
  const desktopEnv = Object.fromEntries(desktopEnvironmentKeys.map((key) => [key, requiredValue(env, key)]))
  const command = { command: '/usr/local/bin/cua-driver', args: ['mcp', '--direct'], env: desktopEnv }
  const plans = await Promise.all([
    planMcp(join(claudeDir, '.claude.json'), { ...command, type: 'stdio', alwaysLoad: true }),
    planMcp(join(piDir, 'mcp.json'), { ...command, lifecycle: 'eager' }, true),
  ])
  const skill = await readFile(new URL('./skills/computer-desktop/SKILL.md', import.meta.url), 'utf8')
  const skillPaths = [claudeDir, piDir].map((directory) => join(directory, 'skills/computer-desktop/SKILL.md'))
  const missingSkills = (await Promise.all(skillPaths.map(async (path) => await regularFile(path) ? undefined : path)))
    .filter((path) => path !== undefined)

  // Validate both providers before writing either, so malformed user JSON is never replaced.
  for (const plan of plans) if (plan.content !== undefined) await atomicWrite(plan.path, plan.content)
  for (const path of missingSkills) await atomicWrite(path, skill)
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

async function planMcp(path, definition, pi = false) {
  let config = {}
  if (await regularFile(path)) {
    try { config = JSON.parse(stripJsonComments(await readFile(path, 'utf8'), { trailingCommas: true })) }
    catch { throw new Error(`Invalid JSON in desktop MCP configuration: ${path}`) }
  }
  if (!isRecord(config)) throw new Error(`Expected a JSON object in desktop MCP configuration: ${path}`)
  const key = pi && config.mcpServers === undefined && config['mcp-servers'] !== undefined ? 'mcp-servers' : 'mcpServers'
  const servers = config[key] === undefined ? {} : config[key]
  if (!isRecord(servers) || Object.values(servers).some((value) => !isRecord(value))) {
    throw new Error(`Expected an MCP server dictionary in ${path}`)
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
