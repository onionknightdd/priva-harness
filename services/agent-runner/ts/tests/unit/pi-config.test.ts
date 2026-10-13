import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ProjectTrustStore } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { assertNativePiMcpConfiguration, piMcpToolExposure, piProjectTrusted, readPiMcpFile, validatePiMcpDefinition } from '../../src/pi-config.js'

let root: string
let agentDir: string
let cwd: string
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pi-native-config-')))
  agentDir = join(root, 'agent')
  cwd = join(root, 'project')
  await mkdir(agentDir)
  await mkdir(join(cwd, '.pi'), { recursive: true })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it('uses saved Pi trust before global defaults, leaving an unknown ask project untrusted', async () => {
  expect(piProjectTrusted(cwd, agentDir)).toBe(true)
  await writeFile(join(cwd, '.pi/mcp.json'), '{}')
  expect(piProjectTrusted(cwd, agentDir)).toBe(false)
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProjectTrust: 'always' }))
  expect(piProjectTrusted(cwd, agentDir)).toBe(true)
  new ProjectTrustStore(agentDir).set(cwd, false)
  expect(piProjectTrusted(cwd, agentDir)).toBe(false)
  new ProjectTrustStore(agentDir).set(cwd, true)
  expect(piProjectTrusted(cwd, agentDir)).toBe(true)
})

it('matches exact exposure before ordered patterns and restores the native default', () => {
  const definition = { exposure: 'hidden', toolExposure: { 'read_*': 'deferred', '*': 'codemode', read_secret: 'hidden' } }
  expect(piMcpToolExposure(definition, 'read_file')).toBe('deferred')
  expect(piMcpToolExposure(definition, 'read_secret')).toBe('hidden')
  expect(piMcpToolExposure(definition, 'write_file')).toBe('codemode')
  expect(piMcpToolExposure({}, 'echo')).toBe('codemode')
})

it('rejects old fields before connecting and leaves ignored project files untouched', async () => {
  const path = join(cwd, '.pi/mcp.json')
  const original = JSON.stringify({ mcpServers: { files: { command: 'must-not-run', disabled: true } } })
  await writeFile(path, original)
  await assertNativePiMcpConfiguration(cwd, agentDir, false)
  await expect(assertNativePiMcpConfiguration(cwd, agentDir, true)).rejects.toThrow('obsolete Pi MCP adapter fields disabled')
  expect(await readFile(path, 'utf8')).toBe(original)
})

it('requires native strict JSON and rejects adapter discovery settings', async () => {
  const path = join(agentDir, 'mcp.json')
  await writeFile(path, '{ // old comment\n "mcpServers": {} }')
  await expect(readPiMcpFile(path)).rejects.toThrow('valid JSON')
  await writeFile(path, JSON.stringify({ imports: ['claude'], mcpServers: {} }))
  await expect(readPiMcpFile(path)).rejects.toThrow('no longer supported')
})

it('accepts native transports and rejects invalid exposure, names and overrides', () => {
  expect(validatePiMcpDefinition({ url: 'https://example.test/mcp', exposure: 'codemode', oauth: { clientId: 'fixture' } }, false, 'docs')).toMatchObject({ exposure: 'codemode' })
  expect(validatePiMcpDefinition({ enabled: false }, true)).toEqual({ enabled: false })
  expect(() => validatePiMcpDefinition({ args: ['project'] }, true)).toThrow('overrides may only')
  expect(() => validatePiMcpDefinition({ command: 'node', exposure: 'everything' })).toThrow('exposure')
  expect(() => validatePiMcpDefinition({ command: 'node' }, false, 'invalid/name')).toThrow('names')
  expect(() => validatePiMcpDefinition({ url: 'wss://example.test/mcp' })).toThrow('HTTP or HTTPS')
})
