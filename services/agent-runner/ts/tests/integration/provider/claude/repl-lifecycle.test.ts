import { HOOK_EVENTS, query, type HookCallback, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import Fastify from 'fastify'
import { expect, it, vi } from 'vitest'
import * as computer from '../../../../src/core/plugin/computer-use.js'
import { PushableStream } from '../../../../src/core/stream/pushable-stream.js'
import { resolveBundledClaudeExecutable } from '../../../../src/provider/claude/claude-executable.js'
import { resolveClaudeQueryOptions } from '../../../../src/provider/claude/claude-runtime.js'
import { claudeUserMessage } from '../../../../src/provider/claude/claude-user-message.js'
import { claudeTerminalLaunch } from '../../../../src/provider/claude/terminal/claude-terminal-launch.js'
import { modelMessage, type ModelRequest } from '../../../fixtures/terminal/claude-tui-fixture.js'
import { testRunSpec } from '../../../support/run-spec.js'

interface RecordEntry {
  server: string; pid: number; method: string; tool?: string
  input?: { hook_event_name: string; session_id: string; turn_id: string }
}
const executable = resolveBundledClaudeExecutable()
const workers = ['cua_repl', 'node_repl']

it.skipIf(!executable).each(['sdk', 'cli'])('%s sends cleanup on the connected REPLs without offering it to the model', async (driver) => {
  if (!executable) throw new Error('Claude test executable is unavailable')
  const root = await mkdtemp(join(tmpdir(), 'priva-repl-hook-'))
  const config = join(root, 'claude')
  const log = join(root, 'requests.jsonl')
  await mkdir(config)
  const fixture = fileURLToPath(new URL('../../../fixtures/terminal/repl-lifecycle-server.ts', import.meta.url))
  const servers = Object.fromEntries(workers.map((server) => [server, { type: 'stdio' as const, command: process.execPath,
    args: ['--import', createRequire(import.meta.url).resolve('tsx'), fixture, log, server], env: {} }]))
  const registration = vi.spyOn(computer, 'computerMcpServers').mockReturnValue(servers)
  const model = Fastify()
  const advertised = new Set<string>()
  const bridgeEvents: string[] = []
  let launched = false
  model.post<{ Body: { event: string } }>('/events', (request) => {
    bridgeEvents.push(request.body.event)
    return {}
  })
  model.post('/v1/messages/count_tokens', () => ({ input_tokens: 10 }))
  model.post('/v1/messages', (request, reply) => {
    const body = request.body as ModelRequest
    const toolNames = (body.tools ?? []).map((tool) => String(tool['name']))
    for (const name of toolNames) advertised.add(name)
    if (!launched && toolNames.includes('Agent')) {
      launched = true
      return modelMessage(body, reply, [{ type: 'tool_use', id: 'child', name: 'Agent',
        input: { description: 'Exercise subagent lifecycle', subagent_type: 'general-purpose', prompt: 'Reply OK without tools.' } }])
    }
    return modelMessage(body, reply, [{ type: 'text', text: 'OK' }])
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const baseUrl = await model.listen({ host: '127.0.0.1', port: 0 })
    const spec = testRunSpec({ cwd: root, model: 'claude-sonnet-4-6', baseUrl, authToken: 'fixture-token', promptSuggestions: false })
    const target = { kind: 'new', provider: 'claude', sessionId: randomUUID() } as const
    const env = { PATH: process.env['PATH'], HOME: root, CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_TOOL_SEARCH: 'false', ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_API_KEY: 'fixture-token' }
    if (driver === 'sdk') {
      const run = query({ prompt: 'Start the fixture subagent.', options: { ...resolveClaudeQueryOptions(spec, target),
        env, strictMcpConfig: true, abortController: controller, persistSession: false } })
      try {
        const results = []
        for await (const message of run) if (message.type === 'result') results.push(message.subtype)
        expect(results).toContain('success')
      } finally { run.close() }
    } else {
      const launch = await claudeTerminalLaunch({ target, spec, executable,
        context: { scratchDir: root, cols: 80, rows: 24, eventsUrl: baseUrl + '/events' } })
      await promisify(execFile)(launch.command, [...launch.args, '--strict-mcp-config', '--no-session-persistence',
        '--setting-sources', '', '--print', 'Start the fixture subagent.'], { cwd: root, env, signal: controller.signal })
    }
    expect(launched).toBe(true)
    const records = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as RecordEntry)
    if (driver === 'cli') {
      expect(bridgeEvents).toContain('stop')
      const events = (await readFile(join(root, 'claude-terminal-events.jsonl'), 'utf8')).trim().split('\n')
        .map((line) => JSON.parse(line) as { hook_event_name: string; agent_id?: string; prompt_id?: string })
      const stopped = events.find((event) => event.hook_event_name === 'SubagentStop')
      expect(stopped?.agent_id).toBeTruthy()
      for (const server of workers) expect(records).toContainEqual(expect.objectContaining({
        server, tool: 'turn_ended', input: { hook_event_name: 'SubagentStop', session_id: stopped?.agent_id, turn_id: stopped?.prompt_id },
      }))
    }
    for (const server of workers) {
      expect(advertised).toContain(`mcp__${server}__marker`)
      expect(advertised).not.toContain(`mcp__${server}__turn_ended`)
      const owned = records.filter((record) => record.server === server)
      const connection = owned.find((record) => record.method === 'initialize')
      const calls = owned.filter((record) => record.tool === 'turn_ended')
      expect(new Set(calls.map((record) => record.input?.hook_event_name))).toEqual(new Set(['Stop', 'SubagentStop']))
      expect(new Set(calls.map((record) => JSON.stringify(record.input))).size).toBe(calls.length)
      expect(calls.every((record) => record.pid === connection?.pid)).toBe(true)
      const main = calls.find((record) => record.input?.hook_event_name === 'Stop')?.input
      const child = calls.find((record) => record.input?.hook_event_name === 'SubagentStop')?.input
      expect(main?.session_id).toBe(target.sessionId)
      expect(child?.session_id).toMatch(/^[a-z\d-]+$/u)
      expect(child?.session_id).not.toBe(target.sessionId)
      expect(calls.some((record) => record.input?.hook_event_name === 'Stop' && record.input.turn_id === child?.turn_id)).toBe(true)
      for (const call of calls) expect(call.input?.turn_id).toMatch(/^[a-f\d-]{36}$/u)
    }
  } finally {
    clearTimeout(timeout)
    registration.mockRestore()
    await model.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}, 35_000)

it.skipIf(!executable)('observes the public hooks when a live SDK stream is interrupted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'priva-repl-interrupt-'))
  const model = Fastify()
  const prompt = new PushableStream<SDKUserMessage>()
  const hooks: string[] = []
  const observed: HookCallback = (event) => { hooks.push(event.hook_event_name); return Promise.resolve({}) }
  model.post('/v1/messages/count_tokens', () => ({ input_tokens: 10 }))
  model.post('/v1/messages', (request, reply) => {
    const body = request.body as ModelRequest
    if (!body.stream || !JSON.stringify(body.messages).includes('hold the fixture stream')) {
      return modelMessage(body, reply, [{ type: 'text', text: 'OK' }])
    }
    reply.hijack()
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const event of [
      { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant',
        model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'waiting' } },
    ]) reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  let session: Query | undefined
  try {
    const baseUrl = await model.listen({ host: '127.0.0.1', port: 0 })
    const options = resolveClaudeQueryOptions(testRunSpec({ cwd: root, model: 'claude-sonnet-4-6',
      baseUrl, authToken: 'fixture-token', promptSuggestions: false }))
    session = query({ prompt, options: { ...options, abortController: controller, persistSession: false,
      strictMcpConfig: true, settingSources: [], tools: [],
      hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, [{ hooks: [observed] }]])),
      env: { HOME: root, PATH: process.env['PATH'], CLAUDE_CONFIG_DIR: root,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_API_KEY: 'fixture-token' } } })
    prompt.push(await claudeUserMessage({ text: 'hold the fixture stream' }))
    let interrupted = false
    let hooksAtResult: string[] | undefined
    for await (const message of session) {
      if (!interrupted && message.type === 'stream_event' && message.event.type === 'content_block_delta') {
        await session.interrupt()
        interrupted = true
      }
      if (message.type === 'result') { hooksAtResult = [...hooks]; break }
    }
    expect(interrupted).toBe(true)
    expect(hooksAtResult).toContain('UserPromptSubmit')
    expect(hooksAtResult?.filter((event) => ['Stop', 'StopFailure', 'SessionEnd'].includes(event))).toEqual([])
  } finally {
    clearTimeout(timeout)
    prompt.close()
    session?.close()
    model.server.closeAllConnections()
    await model.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}, 25_000)
