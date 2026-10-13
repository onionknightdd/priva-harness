import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { hasTrustRequiringProjectResources, ProjectTrustStore, SettingsManager, type McpExposure } from '@earendil-works/pi-coding-agent'

import { ResourceError } from './core/resource/resource-catalog.js'
import type { ResourceDiagnostic } from './core/resource/resource-catalog.js'
import { asRecord } from './core/event/json-record.js'

const exposures = new Set(['codemode', 'deferred', 'direct', 'hidden', 'codemode-deferred'])
const overrideKeys = new Set(['enabled', 'exposure', 'toolExposure'])
const legacyServerKeys = new Set(['disabled', 'includeTools', 'excludeTools', 'toolPrefix', 'httpTransport', 'socket', 'lifecycle', 'inheritEnv', 'bearerToken', 'bearerTokenEnv', 'bearerTokenStore', 'requestHeadersCommand', 'headersHelper', 'authProvider', 'connectionTimeout'])
const serverKeys = new Set(['command', 'args', 'env', 'cwd', 'url', 'type', 'headers', 'oauth', 'auth', 'description', 'enabled', 'exposure', 'toolExposure', 'timeout'])

function isRecord(value: unknown): value is Record<string, unknown> { return asRecord(value) !== undefined }
function record(value: unknown): Record<string, unknown> { return asRecord(value) ?? {} }

/** Directory previews never connect servers or run credential commands. The native
 * extension remains the authority that loads and runs these files in a session. */
export async function readPiMcpFile(path: string): Promise<Record<string, unknown>> {
  let raw: string
  try { raw = await readFile(path, 'utf8') } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}
    throw error
  }
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new ResourceError(422, `Pi MCP requires valid JSON in ${path}`) }
  if (!isRecord(value) || (value['mcpServers'] !== undefined && !isRecord(value['mcpServers']))) throw new ResourceError(422, `Expected an object with mcpServers in ${path}`)
  const obsolete = ['imports', 'settings', 'mcp-servers'].filter((key) => Object.hasOwn(value, key))
  if (obsolete.length) throw new ResourceError(422, `Pi MCP adapter configuration is no longer supported in ${path}: ${obsolete.join(', ')}. Configure native mcpServers explicitly; this file was not changed.`)
  if (value['autoEnableCodemode'] !== undefined && typeof value['autoEnableCodemode'] !== 'boolean') throw new ResourceError(422, 'autoEnableCodemode must be a boolean')
  return value
}

export function piProjectTrusted(cwd: string, agentDir: string): boolean {
  if (!hasTrustRequiringProjectResources(cwd)) return true
  const decision = new ProjectTrustStore(agentDir).get(cwd)
  if (decision !== null) return decision
  return SettingsManager.create(cwd, agentDir, { projectTrusted: false }).getDefaultProjectTrust() === 'always'
}

/** Report known shared files as excluded sources without importing their content. */
export async function ignoredPiMcpSources(cwd: string): Promise<ResourceDiagnostic[]> {
  const diagnostics: ResourceDiagnostic[] = []
  for (const path of [join(homedir(), '.config/mcp/mcp.json'), join(homedir(), '.agents/mcp.json'), join(homedir(), '.agents/mcp/mcp.json'), join(cwd, '.mcp.json')]) {
    try {
      const value = asRecord(JSON.parse(await readFile(path, 'utf8')))
      if (Object.keys(record(value?.['mcpServers'] ?? value?.['mcp-servers'])).length) diagnostics.push({ path, message: 'This shared MCP source is not loaded by native Pi. Configure the required servers in the Pi global or project mcp.json; this file was not changed.' })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) diagnostics.push({ path, message: 'Cannot inspect this shared MCP source; native Pi does not load it' })
    }
  }
  return diagnostics
}

export function isPiMcpOverride(value: Record<string, unknown>): boolean {
  return !['command', 'url', 'type'].some((key) => Object.hasOwn(value, key))
}

export function validatePiMcpDefinition(value: unknown, allowOverride = false, name?: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ResourceError(422, 'MCP definition must be a JSON object')
  if (name !== undefined && !/^[A-Za-z0-9_-]+$/u.test(name)) throw new ResourceError(422, 'Pi MCP names must contain only letters, digits, underscores or hyphens')
  const legacy = Object.keys(value).filter((key) => legacyServerKeys.has(key))
  if (legacy.length) throw new ResourceError(422, `Obsolete Pi MCP adapter fields: ${legacy.join(', ')}. Reconfigure using enabled, exposure and toolExposure; no automatic conversion is performed.`)
  const unknown = Object.keys(value).filter((key) => !serverKeys.has(key))
  if (unknown.length) throw new ResourceError(422, `Unsupported native Pi MCP fields: ${unknown.join(', ')}`)
  const definition = structuredClone(value)
  if (isPiMcpOverride(definition)) {
    if (!allowOverride) throw new ResourceError(422, 'A Pi MCP server needs command or url; project overrides require an existing global server')
    if (Object.keys(definition).some((key) => !overrideKeys.has(key))) throw new ResourceError(422, 'Pi project overrides may only set enabled, exposure and toolExposure')
  } else {
    const transports = ['command', 'url'].filter((key) => typeof definition[key] === 'string' && definition[key].trim())
    if (transports.length !== 1) throw new ResourceError(422, 'Specify exactly one of command or url')
    if (definition['command'] !== undefined && definition['type'] !== undefined && definition['type'] !== 'stdio') throw new ResourceError(422, 'Pi command servers use stdio')
    if (definition['url'] !== undefined) {
      if (definition['type'] !== undefined && (typeof definition['type'] !== 'string' || !['http', 'streamable-http'].includes(definition['type']))) throw new ResourceError(422, 'Pi supports Streamable HTTP; legacy SSE is not supported')
      try { if (typeof definition['url'] !== 'string' || !['http:', 'https:'].includes(new URL(definition['url']).protocol)) throw new Error() } catch { throw new ResourceError(422, 'Pi MCP URL must use HTTP or HTTPS') }
    }
  }
  for (const key of ['command', 'url', 'cwd', 'type', 'description']) if (definition[key] !== undefined && typeof definition[key] !== 'string') throw new ResourceError(422, `${key} must be a string`)
  if (definition['args'] !== undefined && (!Array.isArray(definition['args']) || definition['args'].some((entry) => typeof entry !== 'string'))) throw new ResourceError(422, 'args must be an array of strings')
  for (const key of ['env', 'headers']) if (definition[key] !== undefined && (!isRecord(definition[key]) || Object.values(definition[key]).some((entry) => typeof entry !== 'string'))) throw new ResourceError(422, `${key} must map names to strings`)
  if (definition['enabled'] !== undefined && typeof definition['enabled'] !== 'boolean') throw new ResourceError(422, 'enabled must be a boolean')
  if (definition['timeout'] !== undefined && (typeof definition['timeout'] !== 'number' || !Number.isFinite(definition['timeout']) || definition['timeout'] <= 0)) throw new ResourceError(422, 'timeout must be a positive number of seconds')
  if (definition['exposure'] !== undefined && (typeof definition['exposure'] !== 'string' || !exposures.has(definition['exposure']))) throw new ResourceError(422, 'exposure must be codemode, deferred, direct or hidden')
  if (definition['toolExposure'] !== undefined && (!isRecord(definition['toolExposure']) || Object.values(definition['toolExposure']).some((entry) => typeof entry !== 'string' || !exposures.has(entry)))) throw new ResourceError(422, 'toolExposure must map tool names or patterns to codemode, deferred, direct or hidden')
  if (definition['oauth'] !== undefined && !isRecord(definition['oauth'])) throw new ResourceError(422, 'oauth must be a native Pi OAuth configuration object')
  if (definition['auth'] !== undefined && (!isRecord(definition['auth']) || typeof definition['auth']['provider'] !== 'string' || !definition['auth']['provider'])) throw new ResourceError(422, 'auth must name a Pi provider')
  return definition
}

export function piMcpToolExposure(definition: Record<string, unknown>, name: string): McpExposure {
  const values = record(definition['toolExposure'])
  const direct = values[name]
  if (typeof direct === 'string' && exposures.has(direct)) return direct === 'codemode-deferred' ? 'codemode' : direct as McpExposure
  for (const [pattern, exposure] of Object.entries(values)) {
    const expression = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*')
    if (new RegExp(`^${expression}$`, 'u').test(name) && typeof exposure === 'string' && exposures.has(exposure)) return exposure === 'codemode-deferred' ? 'codemode' : exposure as McpExposure
  }
  const exposure = definition['exposure']
  return typeof exposure === 'string' && exposures.has(exposure) && exposure !== 'codemode-deferred' ? exposure as McpExposure : 'codemode'
}

/** Old adapter flags can silently enable previously disabled tools in native Pi.
 * Reject them before session_start connects anything; never rewrite user files. */
export async function assertNativePiMcpConfiguration(cwd: string, agentDir: string, trusted: boolean): Promise<void> {
  for (const path of [join(agentDir, 'mcp.json'), ...(trusted ? [join(cwd, '.pi/mcp.json')] : [])]) {
    const config = await readPiMcpFile(path)
    for (const [name, value] of Object.entries(record(config['mcpServers']))) {
      if (!isRecord(value)) continue
      const legacy = Object.keys(value).filter((key) => legacyServerKeys.has(key))
      if (legacy.length) throw new ResourceError(422, `${path}: ${name} uses obsolete Pi MCP adapter fields ${legacy.join(', ')}. Reconfigure this server for native Pi before starting; no configuration was changed.`)
    }
  }
}
