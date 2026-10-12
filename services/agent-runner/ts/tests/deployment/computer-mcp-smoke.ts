import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { createAgentSession, getAgentDir, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

import type { McpDetail, McpSummary, ResourceList } from '../../src/core/resource/resource-catalog.js'
import { createPiResourceLoader } from '../../src/provider/pi/pi-resource-loader.js'

// Opt-in Linux deployment probe: it briefly controls an isolated Mousepad window.
// The fixture starts empty; only real MCP keyboard input writes the proof text.
assert.equal(process.platform, 'linux', 'Run this probe inside the Debian desktop container')
assert.notEqual(process.getuid?.(), 0)
assert.equal(process.env['DISPLAY'], ':99')
const cwd = process.env['WORKSPACE_DIR'] ?? ''
assert.equal(cwd, '/data/workspace')
const origin = process.argv[2] ?? 'http://127.0.0.1:8001'

async function resource<T>(harness: 'claude' | 'pi', id?: string): Promise<T> {
  const url = new URL(`/api/sandbox/resource/mcp${id === undefined ? '' : `/${encodeURIComponent(id)}`}`, origin)
  url.searchParams.set('harness', harness)
  url.searchParams.set('cwd', cwd)
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  assert.equal(response.status, 200, `${harness} MCP resource request failed: ${response.status}`)
  return await response.json() as T
}

const definitions: Record<string, unknown>[] = []
for (const harness of ['claude', 'pi'] as const) {
  const catalog = await resource<ResourceList<McpSummary>>(harness)
  const computers = catalog.groups.flatMap((group) => group.items)
    .filter((item) => item.name === 'computer' && item.enabled && item.effective)
  assert.equal(computers.length, 1, `${harness} must expose one enabled, effective computer MCP`)
  const computer = computers[0]
  assert.ok(computer)
  const detail = await resource<McpDetail>(harness, computer.id)
  assert.equal(detail.transport, 'stdio')
  const definition = detail.effectiveDefinition
  assert.ok(definition, `${harness} must resolve its effective computer definition`)
  assert.equal(definition['command'], '/usr/local/bin/cua-driver')
  assert.deepEqual(definition['args'], ['mcp', '--direct'])
  definitions.push(definition)
}

const definition = definitions[0]
assert.ok(definition)
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
assert.notEqual(definition['inheritEnv'], false, 'The computer MCP must inherit the container desktop environment')
if (definition['env'] !== undefined) {
  assert.ok(typeof definition['env'] === 'object' && definition['env'] !== null && !Array.isArray(definition['env']))
  for (const [key, value] of Object.entries(definition['env'])) {
    assert.equal(typeof value, 'string', `MCP environment ${key} must be a string`)
    env[key] = value as string
  }
}

const client = new Client({ name: 'priva-computer-deployment-probe', version: '1.0.0' })
const transport = new StdioClientTransport({ command: definition['command'] as string,
  args: definition['args'] as string[], cwd, env, stderr: 'pipe', maxBufferSize: 10 * 1024 * 1024 })
transport.stderr?.on('data', () => undefined)
type ToolResult = Awaited<ReturnType<Client['callTool']>>

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const result = await client.callTool({ name, arguments: args }, { timeout: 30_000 })
  assert.notEqual(result.isError, true, `${name}: ${result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')}`)
  return result
}

function structured(result: ToolResult): Record<string, unknown> {
  const value = result.structuredContent
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), 'The Cua tool must return structured metadata')
  return value as Record<string, unknown>
}

function records(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value))
  return value.map((item: unknown) => {
    assert.ok(typeof item === 'object' && item !== null && !Array.isArray(item))
    return item as Record<string, unknown>
  })
}

async function windows(pid?: number): Promise<Record<string, unknown>[]> {
  return records(structured(await call('list_windows', pid === undefined ? {} : { pid }))['windows'])
}

const temporaryDirectory = await mkdtemp(join(cwd, '.computer-mcp-smoke-'))
const proofPath = join(temporaryDirectory, `proof-${randomUUID()}.txt`)
const expected = `Computer MCP deployment verification\n中文输入验证：你好，Debian 桌面。\nNonce: ${randomUUID()}\n`
let ownedPid: number | undefined
let ownedWindow: number | undefined
let toolCount: number
let serverVersion: string | undefined

async function ownsProcess(): Promise<boolean> {
  if (ownedPid === undefined) return false
  try {
    const args = (await readFile(`/proc/${ownedPid}/cmdline`, 'utf8')).split('\0')
    return args.includes('--disable-server') && args.includes(proofPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

try {
  await client.connect(transport, { timeout: 15_000 })
  const { tools } = await client.listTools()
  toolCount = tools.length
  serverVersion = client.getServerVersion()?.version
  for (const name of ['get_desktop_state', 'launch_app', 'list_windows', 'get_window_state', 'click', 'type_text', 'press_key', 'kill_app']) {
    assert.ok(tools.some((tool) => tool.name === name), `Missing computer tool: ${name}`)
  }
  const desktop = await call('get_desktop_state', { max_image_dimension: 900 })
  const image = desktop.content.find((item) => item.type === 'image')
  assert.ok(image?.mimeType === 'image/png')
  assert.deepEqual(Buffer.from(image.data, 'base64').subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  const existingPids = new Set((await windows()).map((window) => window['pid']))
  await writeFile(proofPath, '', { flag: 'wx' })
  const launched = structured(await call('launch_app', {
    name: 'mousepad', additional_arguments: ['--disable-server', '--opening-mode=window', proofPath],
  }))
  const pid = launched['pid']
  assert.ok(typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0, 'Mousepad must report its process ID')
  assert.ok(!existingPids.has(pid), 'The probe must not reuse an existing application process')
  ownedPid = pid
  assert.ok(await ownsProcess(), 'The launched process must own this probe fixture')

  for (let attempt = 0; attempt < 30; attempt++) {
    const window = (await windows(pid)).find((entry) => typeof entry['title'] === 'string' && entry['title'].includes(basename(proofPath)))
    if (window && typeof window['window_id'] === 'number') { ownedWindow = window['window_id']; break }
    await delay(100)
  }
  assert.ok(ownedWindow !== undefined, 'Mousepad did not expose the fixture window')
  const target = { pid, window_id: ownedWindow }
  const snapshot = structured(await call('get_window_state', { ...target, include_screenshot: false, max_elements: 100, timeout_ms: 5000 }))
  const editor = records(snapshot['elements']).find((element) => element['role'] === 'text' && typeof element['element_token'] === 'string')
  assert.ok(editor, 'Mousepad must expose an editable document element')
  await call('click', { ...target, element_token: editor['element_token'], delivery_mode: 'foreground' })
  // Cua 0.34.1's targeted AT-SPI text route truncates some UTF-8 input.
  // Foreground keyboard delivery deliberately omits element_token.
  await call('type_text', { ...target, text: expected, delivery_mode: 'foreground' })
  await call('press_key', { ...target, key: 's', modifiers: ['ctrl'], delivery_mode: 'foreground' })
  let actual = ''
  for (let attempt = 0; attempt < 30; attempt++) {
    actual = await readFile(proofPath, 'utf8')
    if (actual === expected) break
    await delay(100)
  }
  assert.equal(actual, expected, 'Only MCP input and the GUI save may write the Chinese nonce text')
} finally {
  try {
    if (await ownsProcess()) {
      if (ownedWindow !== undefined) {
        await call('press_key', { pid: ownedPid, window_id: ownedWindow, key: 'q', modifiers: ['ctrl'], delivery_mode: 'foreground' })
        for (let attempt = 0; attempt < 10 && await ownsProcess(); attempt++) await delay(100)
      }
      // Only this --disable-server process owns the unique temporary path.
      // Failed probes may leave an unsaved confirmation dialog, which is safe to discard.
      if (await ownsProcess()) await call('kill_app', { pid: ownedPid })
      assert.equal(await ownsProcess(), false, 'The probe Mousepad process was not cleaned up')
    }
  } finally {
    await client.close()
    await transport.close()
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

// Exercise the actual Pi resource adapter without making a model request.
const agentDir = getAgentDir()
const settingsManager = SettingsManager.create(cwd, agentDir)
const resourceLoader = await createPiResourceLoader(cwd, agentDir, settingsManager)
assert.deepEqual(resourceLoader.getExtensions().errors, [])
const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(cwd) })
try {
  await session.bindExtensions({ mode: 'rpc' })
  const mcp = session.agent.state.tools.find((tool) => tool.name === 'mcp')
  assert.ok(mcp, 'Pi must load its native MCP adapter')
  const result = await mcp.execute('computer-deployment-screenshot', {
    server: 'computer', tool: 'get_desktop_state', args: { max_image_dimension: 900 },
  }, AbortSignal.timeout(30_000))
  assert.ok(result.content.some((item) => item.type === 'image'), 'The desktop screenshot must reach Pi through its MCP adapter')
} finally {
  await session.abort()
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
  session.dispose()
}

console.log(JSON.stringify({ providers: ['claude', 'pi'], serverVersion, toolCount,
  checks: ['effective native MCP definitions', 'persistent stdio MCP connection', 'desktop PNG', 'isolated Mousepad launch', 'foreground Chinese input', 'GUI save and exact file comparison', 'owned window cleanup', 'Pi resource adapter screenshot'] }, null, 2))
