import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProviderRunSpec, SessionTarget } from '../../../../src/core/contract/agent-provider.js'
import type { TerminalLaunchContext, TerminalLaunchSpec } from '../../../../src/core/contract/terminal-service.js'
import type { ThreadReplayItem } from '../../../../src/core/resource/thread.js'
import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'
import { SessionTerminals } from '../../../../src/harness/terminal/session-terminals.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { TmuxTerminalService } from '../../../../src/infrastructure/terminal/tmux-terminal-service.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { TERMINAL_WEBSOCKET_PATH } from '../../../../src/transport/websocket/terminal-route.js'
import { SESSION_WEBSOCKET_PATH } from '../../../../src/transport/websocket/run-route.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

interface JsonFrame { type: string; [key: string]: unknown }

// Listeners are attached before the connection opens so an error the server
// sends immediately after the upgrade is never missed.
function connect(address: string) {
  const socket = new WebSocket(address)
  const json: JsonFrame[] = []
  const output: Uint8Array[] = []
  socket.on('message', (raw, isBinary) => {
    const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw)
    if (isBinary) output.push(bytes)
    else json.push(JSON.parse(bytes.toString('utf8')) as JsonFrame)
  })
  return {
    socket,
    json,
    output,
    text: () => Buffer.concat(output).toString('utf8'),
    waitJson: async (type: string) => {
      await expect.poll(() => json.some((frame) => frame.type === type), { timeout: 5000 }).toBe(true)
      return json.find((frame) => frame.type === type) ?? { type }
    },
  }
}

describe.skipIf(!tmuxAvailable())('terminal WebSocket route', () => {
  let root: string
  let server: FastifyInstance
  let harness: AgentHarness
  let terminals: SessionTerminals
  let model: string
  let provider: FakeAgentProvider
  const launches: { target: SessionTarget; spec: ProviderRunSpec; context: TerminalLaunchContext }[] = []

  beforeEach(async () => {
    launches.length = 0
    root = await mkdtemp(join(tmpdir(), 'priva-terminal-ws-'))
    const services = createTestAgentServices(join(root, 'runtime'))
    const profile = await services.modelProfileService.createProfile({
      label: 'Test', baseUrl: 'https://api.example.com/v1', authToken: 'test', defaultModel: 'm',
    })
    model = `${profile.id}:m`
    provider = new FakeAgentProvider('claude', [])
    provider.terminalLaunch = (target, spec, context): Promise<TerminalLaunchSpec> => {
      launches.push({ target, spec, context })
      return Promise.resolve({
        command: 'bash', args: ['--norc', '--noprofile'], cwd: spec.cwd,
        env: { PS1: 'TUI> ', MODEL: spec.model }, cols: context.cols, rows: context.rows,
      })
    }
    const providers = { claude: provider, pi: new FakeAgentProvider('pi', []) }
    harness = new AgentHarness({ providers, cwd: root, liveRuns: new LiveRunRegistry() })
    terminals = new SessionTerminals({
      providers,
      terminals: new TmuxTerminalService({ rootDir: join(root, 'terminals'), sweepIntervalMs: 0 }),
    })
    server = buildHttpServer({
      ...services,
      userFileSystem: new NodeUserFileSystem({ initialDirectory: root }),
      agentHarness: harness,
      sessionTerminals: terminals,
    })
    await server.listen({ port: 0, host: '127.0.0.1' })
  })

  afterEach(async () => {
    await terminals.dispose()
    await harness.disposePool()
    await server.close()
    for (const dir of await readdir(join(root, 'terminals')).catch(() => [] as string[])) {
      try { execFileSync('tmux', ['-S', join(root, 'terminals', dir, 'tmux.sock'), 'kill-server'], { stdio: 'ignore' }) } catch { /* gone */ }
    }
    await rm(root, { recursive: true, force: true })
  })

  const url = (params: Record<string, string>) => {
    const address = server.addresses()[0]
    return `ws://127.0.0.1:${address?.port ?? 0}${TERMINAL_WEBSOCKET_PATH}?${new URLSearchParams(params).toString()}`
  }

  it('opens a new session terminal, streams the screen and keystrokes, and lets a second viewer adopt it', async () => {
    const client = connect(url({ harness: 'claude', cwd: root, model, cols: '90', rows: '15', theme: 'light' }))
    const { socket } = client
    const ready = await client.waitJson('ready')
    expect(ready).toMatchObject({ harness: 'claude', adopted: false, cols: 90, rows: 15 })
    const sessionId = ready['sessionId'] as string
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(launches).toHaveLength(1)
    expect(launches[0]?.target).toEqual({ kind: 'new', provider: 'claude', sessionId })
    expect(launches[0]?.spec.model).toBe('m')
    expect(launches[0]?.context).toMatchObject({ cols: 90, rows: 15, colorScheme: 'light' })

    await expect.poll(() => client.text().includes('TUI>'), { timeout: 5000 }).toBe(true)
    socket.send(Buffer.from('echo $MODEL-echoed\r'), { binary: true })
    await expect.poll(() => client.text().includes('m-echoed'), { timeout: 5000 }).toBe(true)
    socket.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }))
    await expect.poll(async () => (await terminals.capture({ provider: 'claude', id: sessionId })).split('\n').length, { timeout: 5000 }).toBeGreaterThanOrEqual(30)

    const second = connect(url({ harness: 'claude', sessionId, cwd: root, model }))
    const secondReady = await second.waitJson('ready')
    expect(secondReady).toMatchObject({ sessionId, adopted: true, cols: 120, rows: 40 })
    await expect.poll(() => second.text().includes('m-echoed'), { timeout: 5000 }).toBe(true)
    expect(launches).toHaveLength(1)
    socket.close()
    second.socket.close()
  })

  it('rejects a malformed query and a harness without a terminal driver', async () => {
    const bad = connect(url({ harness: 'nope', cwd: root, model }))
    expect(await bad.waitJson('error')).toMatchObject({ kind: 'invalid-request' })
    const pi = connect(url({ harness: 'pi', cwd: root, model }))
    expect(await pi.waitJson('error')).toMatchObject({ kind: 'unsupported' })
    await expect.poll(() => bad.socket.readyState, { timeout: 5000 }).toBe(WebSocket.CLOSED)
  })

  it('delivers TUI transcript changes over the bubble subscription without reopening the session', async () => {
    let changed: () => void = () => undefined
    const unwatch = vi.fn()
    Object.assign(provider.sessions, { watch: (_ref: unknown, _cwd: string, listener: () => void) => {
      changed = listener
      return Promise.resolve(unwatch)
    } })
    const records: ThreadReplayItem[] = []
    vi.spyOn(provider.sessions, 'replay').mockImplementation(() => Promise.resolve([...records]))
    const terminal = connect(url({ harness: 'claude', cwd: root, model }))
    const ready = await terminal.waitJson('ready')
    const sessionId = ready['sessionId'] as string
    const bubbles = connect(url({}).replace(TERMINAL_WEBSOCKET_PATH, SESSION_WEBSOCKET_PATH))
    bubbles.socket.once('open', () => bubbles.socket.send(JSON.stringify({ type: 'session.subscribe', harness: 'claude', sessionId })))
    expect(await bubbles.waitJson('session.snapshot')).toMatchObject({ messages: [] })
    records.push(
      { kind: 'user', id: 'native-user', content: 'TUI 中发送的中文 🚀', createdAt: '2026-09-22T00:00:00.000Z' },
      { kind: 'frame', createdAt: '2026-09-22T00:00:01.000Z', event: { type: 'assistant.message', messageId: 'native-assistant',
        blocks: [{ type: 'text', blockId: 'native-text', index: 0, text: '这是 TUI 的回复' }] } },
    )
    changed()
    await expect.poll(() => bubbles.json.filter((frame) => frame.type === 'session.snapshot').length).toBe(2)
    expect(bubbles.json.at(-1)).toMatchObject({ type: 'session.snapshot', messages: [
      { role: 'user', content: 'TUI 中发送的中文 🚀' }, { role: 'assistant', content: '这是 TUI 的回复' },
    ] })
    expect((await harness.loadSessionStream({ provider: 'claude', id: sessionId })).snapshot().messages).toHaveLength(2)
    terminal.socket.close()
    await expect.poll(() => terminal.socket.readyState).toBe(WebSocket.CLOSED)
    expect(unwatch).not.toHaveBeenCalled()
    records.push({ kind: 'user', id: 'background-user', content: 'arrived after viewer closed', createdAt: '2026-09-22T00:00:02.000Z' })
    changed()
    await expect.poll(() => bubbles.json.filter((frame) => frame.type === 'session.snapshot').length).toBe(3)
    await terminals.close({ provider: 'claude', id: sessionId })
    await harness.terminalExited({ provider: 'claude', id: sessionId }, 'closed')
    await expect.poll(() => unwatch.mock.calls.length).toBe(1)
    bubbles.socket.close()
  })

  it('tells viewers when the program exits', async () => {
    const client = connect(url({ harness: 'claude', cwd: root, model }))
    const { socket } = client
    await client.waitJson('ready')
    await expect.poll(() => client.text().includes('TUI>'), { timeout: 5000 }).toBe(true)
    socket.send(Buffer.from('exit\r'), { binary: true })
    await client.waitJson('exit')
    await expect.poll(() => socket.readyState, { timeout: 5000 }).toBe(WebSocket.CLOSED)
  })
})
