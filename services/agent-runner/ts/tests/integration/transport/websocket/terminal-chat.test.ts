import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { WebSocket } from 'ws'
import { expect, it, vi } from 'vitest'

import type { StreamFrame } from '../../../../src/core/event/agent-event.js'
import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'
import { SessionTerminals } from '../../../../src/harness/terminal/session-terminals.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { TmuxTerminalService } from '../../../../src/infrastructure/terminal/tmux-terminal-service.js'
import { ClaudeProvider } from '../../../../src/provider/claude/claude-provider.js'
import { resolveBundledClaudeExecutable } from '../../../../src/provider/claude/claude-executable.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

function available(): boolean {
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return resolveBundledClaudeExecutable() !== undefined }
  catch { return false }
}

it.skipIf(!available())('creates from bubbles, attaches, reconnects, resumes and forks through the real Claude TUI without an SDK runtime', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'priva-tui-chat-')))
  const configDir = join(root, 'claude')
  await mkdir(configDir)
  vi.stubEnv('CLAUDE_CONFIG_DIR', configDir)
  vi.stubEnv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', '1')
  const modelServer = Fastify()
  let answers = 0
  modelServer.post('/v1/messages/count_tokens', () => ({ input_tokens: 10 }))
  modelServer.post('/v1/messages', (request, reply) => {
    const body = request.body as { model: string; stream?: boolean }
    const text = `同步回复 ${++answers} 🚀`
    const message = { id: `msg-${answers}`, type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 } }
    if (!body.stream) return message
    const frames = [
      { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ]
    return reply.type('text/event-stream').send(frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''))
  })
  await modelServer.listen({ host: '127.0.0.1', port: 0 })
  const services = createTestAgentServices(join(root, 'runtime'))
  const profile = await services.modelProfileService.createProfile({ label: 'Local fixture',
    baseUrl: `http://127.0.0.1:${modelServer.addresses()[0]?.port ?? 0}`, authToken: 'fixture-token', defaultModel: 'claude-sonnet-4-6' })
  const provider = new ClaudeProvider({ globalConfigDir: configDir, globalConfigFilePath: join(configDir, '.claude.json') })
  const sdkOpen = vi.spyOn(provider, 'openSession')
  const providers = { claude: provider, pi: new FakeAgentProvider('pi', []) }
  const harness = new AgentHarness({ providers, cwd: root, liveRuns: new LiveRunRegistry() })
  const terminals = new SessionTerminals({ providers, terminals: new TmuxTerminalService({ rootDir: join(root, 'terminals'), sweepIntervalMs: 0 }) })
  const server = buildHttpServer({ ...services, agentHarness: harness, sessionTerminals: terminals,
    userFileSystem: new NodeUserFileSystem({ initialDirectory: root }) })
  await server.listen({ port: 0, host: '127.0.0.1' })
  const base = `ws://127.0.0.1:${server.addresses()[0]?.port ?? 0}/api/sandbox/agent/ws`
  let terminal: WebSocket | undefined
  let sessionId = ''
  let terminalText = ''
  const frames: StreamFrame[] = []
  let bubbles: WebSocket | undefined
  let fork: WebSocket | undefined
  let forkId = ''
  try {
    bubbles = new WebSocket(`${base}/session`)
    bubbles.on('message', (raw) => {
      const frame = JSON.parse(rawText(raw)) as StreamFrame
      frames.push(frame)
      if (frame.sessionId) sessionId = frame.sessionId
    })
    await new Promise<void>((resolve) => bubbles?.once('open', resolve))
    const send = (text: string, runId: string) => bubbles?.send(JSON.stringify({ type: 'run.start',
      harness: 'claude', model: `${profile.id}:claude-sonnet-4-6`, cwd: root, ...(sessionId ? { sessionId } : {}), runId, text, theme: 'dark' }))
    // No terminal viewer, no pre-existing session, and no test-side wait for
    // the prompt: the production driver must handle cold startup itself.
    send('气泡中文第一条', 'bubble-first')
    await expect.poll(() => frames.filter((frame) => frame.runId === 'bubble-first' && frame.type === 'run.completed'), {
      timeout: 30000, message: 'Bubble input must be acknowledged and completed by the real Claude TUI',
    }).toHaveLength(1)
    expect(sessionId).not.toBe('')
    const ref = { provider: 'claude', id: sessionId } as const
    const messages = () => harness.sessionStream(ref).snapshot().messages
    await expect.poll(() => messages().some((message) => message.role === 'assistant' && message.content.includes('同步回复')), { timeout: 5000 }).toBe(true)
    expect(messages().filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['气泡中文第一条'])
    terminal = new WebSocket(`${base}/terminal?${new URLSearchParams({ harness: 'claude', sessionId, model: `${profile.id}:claude-sonnet-4-6`, cwd: root, cols: '120', rows: '35' }).toString()}`)
    let adopted = false
    terminal.on('message', (data, binary) => {
      if (binary) terminalText += rawText(data)
      else {
        const frame = JSON.parse(rawText(data)) as { type: string; adopted?: boolean; message?: string }
        if (frame.type === 'ready') adopted = frame.adopted === true
        if (frame.type === 'error') terminalText += frame.message ?? ''
      }
    })
    await expect.poll(() => adopted, { timeout: 5000 }).toBe(true)
    await expect.poll(() => terminalText.includes('气泡中文第一条'), { timeout: 5000 }).toBe(true)
    terminal.send(Buffer.from('终端第二条\r'))
    await expect.poll(() => messages().filter((message) => message.role === 'user').map((message) => message.content), { timeout: 30000 }).toEqual(['气泡中文第一条', '终端第二条'])
    await expect.poll(() => harness.sessionStream(ref).snapshot().activeRunId, { timeout: 30000 }).toBeUndefined()
    send('气泡第三条\n包含多行', 'bubble-third')
    await expect.poll(() => frames.some((frame) => frame.runId === 'bubble-third' && frame.type === 'run.completed'), { timeout: 30000 }).toBe(true)
    await expect.poll(() => messages().filter((message) => message.role === 'user').length, { timeout: 5000 }).toBe(3)

    // Losing both browser views does not kill the program or repeat a prompt.
    terminal.close(); bubbles.close()
    bubbles = new WebSocket(`${base}/session`)
    bubbles.on('message', (raw) => frames.push(JSON.parse(rawText(raw)) as StreamFrame))
    await new Promise<void>((resolve) => bubbles?.once('open', resolve))
    bubbles.send(JSON.stringify({ type: 'session.subscribe', harness: 'claude', sessionId }))
    send('重连后的气泡', 'bubble-reconnected')
    await expect.poll(() => frames.some((frame) => frame.runId === 'bubble-reconnected' && frame.type === 'run.completed'), { timeout: 30000 }).toBe(true)

    // An exited native session is resumed by a bubble, never by SDK fallback.
    await terminals.close(ref)
    await harness.terminalExited(ref, 'fixture exit')
    send('恢复退出的终端', 'bubble-resumed')
    await expect.poll(() => frames.some((frame) => frame.runId === 'bubble-resumed' && frame.type === 'run.completed'), { timeout: 30000 }).toBe(true)
    await expect.poll(() => messages().filter((message) => message.role === 'user').length).toBe(5)

    const forkFrames: StreamFrame[] = []
    fork = new WebSocket(`${base}/session`)
    fork.on('message', (raw) => { const frame = JSON.parse(rawText(raw)) as StreamFrame; forkFrames.push(frame); if (frame.sessionId) forkId = frame.sessionId })
    await new Promise<void>((resolve) => fork?.once('open', resolve))
    fork.send(JSON.stringify({ type: 'run.start', harness: 'claude', model: `${profile.id}:claude-sonnet-4-6`,
      cwd: root, sessionId, fork: true, runId: 'bubble-fork', text: '分支气泡' }))
    await expect.poll(() => forkFrames.some((frame) => frame.runId === 'bubble-fork' && frame.type === 'run.completed'), { timeout: 30000 }).toBe(true)
    expect(forkId).not.toBe(sessionId)
    await expect.poll(() => harness.sessionStream({ provider: 'claude', id: forkId }).snapshot().messages.filter((message) => message.role === 'user'), { timeout: 5000 }).toHaveLength(6)
    expect(messages().filter((message) => message.role === 'user')).toHaveLength(5)
    expect(sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    // This is an isolated config/transcript and fake model, safe to report on failure.
    console.error('Isolated TUI output:', terminalText.slice(-10000), frames.filter((frame) => frame.type === 'error' || frame.type === 'run.failed'))
    if (sessionId && await terminals.isAlive({ provider: 'claude', id: sessionId })) console.error(await terminals.capture({ provider: 'claude', id: sessionId }))
    throw error
  } finally {
    terminal?.close(); bubbles?.close(); fork?.close()
    if (sessionId) await terminals.close({ provider: 'claude', id: sessionId })
    if (forkId) await terminals.close({ provider: 'claude', id: forkId })
    await harness.disposePool()
    await terminals.dispose()
    await server.close()
    await modelServer.close()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
}, 120000)

function rawText(data: WebSocket.RawData): string {
  return (Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)).toString('utf8')
}
