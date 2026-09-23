import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import type { FastifyReply } from 'fastify'
import { WebSocket } from 'ws'
import { vi } from 'vitest'
import type { StreamFrame } from '../../../src/core/event/agent-event.js'
import { AgentHarness } from '../../../src/harness/agent-harness.js'
import { SessionTerminals } from '../../../src/harness/terminal/session-terminals.js'
import { NodeUserFileSystem } from '../../../src/infrastructure/filesystem/node-user-file-system.js'
import { TmuxTerminalService } from '../../../src/infrastructure/terminal/tmux-terminal-service.js'
import { ClaudeProvider } from '../../../src/provider/claude/claude-provider.js'
import { resolveBundledClaudeExecutable } from '../../../src/provider/claude/claude-executable.js'
import { buildHttpServer } from '../../../src/transport/http/server.js'
import { FakeAgentProvider } from '../../support/fake-agent-provider.js'
import { createTestAgentServices } from '../../support/model-profile.js'
import { productTools } from '../../../src/core/tool/product-tools.js'
import type { DataRecorder } from '../../../src/core/contract/data-recorder.js'

export function nativeClaudeAvailable(): boolean {
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return resolveBundledClaudeExecutable() !== undefined }
  catch { return false }
}

export interface ModelRequest { system?: unknown; model: string; stream?: boolean; tools?: Record<string, unknown>[]; messages: { role: string; content: string | Record<string, unknown>[] }[] }
export type ModelResponse = (body: ModelRequest, reply: FastifyReply) => unknown

export async function nativeClaudeFixture(respond: ModelResponse, recorder?: DataRecorder, options: { permissionMode?: 'default' } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'priva-tui-l3-')))
  const configDir = join(root, 'claude')
  await mkdir(configDir)
  vi.stubEnv('CLAUDE_CONFIG_DIR', configDir)
  vi.stubEnv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', '1')
  const modelServer = Fastify()
  const requests: ModelRequest[] = []
  modelServer.post('/v1/messages/count_tokens', () => ({ input_tokens: 10 }))
  modelServer.post('/v1/messages', (request, reply) => {
    const body = request.body as ModelRequest
    // Native topic classification is a separate structured call, not an agent turn.
    if (body.tools?.length === 0) return modelMessage(body, reply, [{ type: 'text', text: '{"isNewTopic":false,"title":null}' }], 'topic-check')
    requests.push(body)
    return respond(body, reply)
  })
  await modelServer.listen({ host: '127.0.0.1', port: 0 })
  const services = createTestAgentServices(join(root, 'runtime'))
  const profile = await services.modelProfileService.createProfile({ label: 'Isolated native test',
    baseUrl: `http://127.0.0.1:${modelServer.addresses()[0]?.port ?? 0}`, authToken: 'fixture-token', defaultModel: 'claude-sonnet-4-6' })
  const provider = new ClaudeProvider({ globalConfigDir: configDir, globalConfigFilePath: join(configDir, '.claude.json'), tools: productTools })
  const permissionMode = options.permissionMode
  if (permissionMode) {
    const launch = provider.terminalLaunch.bind(provider)
    vi.spyOn(provider, 'terminalLaunch').mockImplementation(async (...args) => {
      const spec = await launch(...args)
      return { ...spec, args: spec.args.map((arg, index) => spec.args[index - 1] === '--permission-mode' ? permissionMode : arg) }
    })
  }
  const sdkOpen = vi.spyOn(provider, 'openSession')
  const providers = { claude: provider, pi: new FakeAgentProvider('pi', []) }
  const harness = new AgentHarness({ providers, cwd: root, ...(recorder ? { recorder } : {}) })
  const terminals = new SessionTerminals({ providers, terminals: new TmuxTerminalService({ rootDir: join(root, 'terminals'), sweepIntervalMs: 0 }) })
  const server = buildHttpServer({ ...services, agentHarness: harness, sessionTerminals: terminals,
    userFileSystem: new NodeUserFileSystem({ initialDirectory: root }) })
  await server.listen({ host: '127.0.0.1', port: 0 })
  const base = `ws://127.0.0.1:${server.addresses()[0]?.port ?? 0}/api/sandbox/agent/ws`
  const socket = new WebSocket(`${base}/session`)
  const frames: StreamFrame[] = []
  const sessions = new Set<string>()
  let sessionId = ''
  socket.on('message', (raw) => {
    const frame = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : Buffer.from(raw as ArrayBuffer).toString('utf8')) as StreamFrame
    frames.push(frame)
    if (frame.sessionId) { sessionId = frame.sessionId; sessions.add(sessionId) }
  })
  await new Promise<void>((resolve) => socket.once('open', resolve))
  return {
    root, configDir, harness, terminals, frames, requests, socket, sdkOpen, profile, services, base,
    get ref() { return { provider: 'claude', id: sessionId } as const },
    send(text: string, runId: string, model = 'claude-sonnet-4-6', options: { effort?: string; profileId?: string; runMode?: 'agent' | 'code' } = {}) {
      socket.send(JSON.stringify({ type: 'run.start', harness: 'claude', cwd: root, text, runId, ...(options.runMode ? { runMode: options.runMode } : {}),
        model: `${options.profileId ?? profile.id}:${model}`, ...(options.effort ? { effort: options.effort } : {}), ...(sessionId ? { sessionId } : {}) }))
    },
    async dispose() {
      socket.close()
      for (const id of sessions) await terminals.close({ provider: 'claude', id })
      await harness.disposePool(); await terminals.dispose(); await server.close(); await modelServer.close()
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    },
  }
}

export function modelMessage(body: ModelRequest, reply: FastifyReply, content: Record<string, unknown>[], id = 'test-message') {
  const stop_reason = content.some((block) => block['type'] === 'tool_use') ? 'tool_use' : 'end_turn'
  const message = { id, type: 'message', role: 'assistant', model: body.model, content, stop_reason,
    stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }
  if (!body.stream) return message
  const events: Record<string, unknown>[] = [{ type: 'message_start', message: { ...message, content: [], stop_reason: null } }]
  content.forEach((block, index) => {
    const tool = block['type'] === 'tool_use'
    events.push({ type: 'content_block_start', index, content_block: tool ? { ...block, input: {} } : { ...block, text: '' } },
      { type: 'content_block_delta', index, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(block['input']) } : { type: 'text_delta', text: block['text'] } },
      { type: 'content_block_stop', index })
  })
  events.push({ type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } }, { type: 'message_stop' })
  return reply.type('text/event-stream').send(events.map((event) => `event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}
