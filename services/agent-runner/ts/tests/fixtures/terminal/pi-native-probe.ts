// Real Pi TUI + Chat control, with a local Responses server and isolated HOME.
import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import type * as PiTerminalLaunch from '../../../src/provider/pi/pi-terminal-launch.js'
import type { StreamFrame } from '../../../src/core/event/agent-event.js'
import type { ProviderRunSpec } from '../../../src/core/contract/agent-provider.js'
import type { TerminalActivity, TerminalStatus } from '../../../src/core/contract/terminal-service.js'
import { TmuxTerminalService } from '../../../src/infrastructure/terminal/tmux-terminal-service.js'
import { readPiTerminalJson, readPiTerminalTelemetry } from '../../../src/provider/pi/pi-terminal-protocol.js'
import { MemoryDataRecorder } from '../../support/memory-data-recorder.js'

const root = await realpath(await mkdtemp(join(os.tmpdir(), 'pi-native-')))
os.homedir = () => root
syncBuiltinESMExports()
const agentDir = join(root, 'agent')
process.env['PI_CODING_AGENT_DIR'] = agentDir
const { ProjectTrustStore, SessionManager } = await import('@earendil-works/pi-coding-agent')
const { piTerminalLaunch } = await import(pathToFileURL(resolve(process.argv[2] ?? 'src/provider/pi/pi-terminal-launch.ts')).href) as typeof PiTerminalLaunch
const { piSessionBucketDir } = await import('../../../src/provider/pi/pi-paths.js')
const { PiProvider } = await import('../../../src/provider/pi/pi-provider.js')
const { PiSessionStore } = await import('../../../src/provider/pi/pi-session-store.js')
const { CodingAgentSessionFactory } = await import('../../../src/provider/pi/pi-session-factory.js')
const { ClaudeProvider } = await import('../../../src/provider/claude/claude-provider.js')
const { AgentHarness } = await import('../../../src/harness/agent-harness.js')
const { SessionTerminals } = await import('../../../src/harness/terminal/session-terminals.js')
const requests: Record<string, unknown>[] = []
const events: TerminalActivity[] = []
let offset = 0
let scratchDir = ''
let modelError: Error | undefined
let sequence = 0
let compactionResponse: 'wait' | 'success' | undefined

function respond(response: ServerResponse, item: Record<string, unknown>): void {
  const id = `response-${++sequence}`
  const stream: Record<string, unknown>[] = [
    { type: 'response.created', response: { id, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', ...(item['type'] === 'function_call' ? { arguments: '' } : { content: [] }) } },
  ]
  if (item['type'] === 'function_call') {
    stream.push({ type: 'response.function_call_arguments.delta', output_index: 0, delta: item['arguments'] })
  } else {
    const text = ((item['content'] as { text: string }[])[0])?.text ?? ''
    stream.push({ type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text })
  }
  stream.push({ type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 } } } })
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(stream.map((event) => `event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}

const server = createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk: string) => { body += chunk })
  request.on('end', () => {
    try {
      assert.match(request.url ?? '', /\/responses$/u)
      const parsed = JSON.parse(body) as Record<string, unknown>
      requests.push(parsed)
      assert.equal(parsed['model'], 'deepseek-flash')
      if (compactionResponse) {
        if (compactionResponse === 'success') respond(response, { type: 'message', id: 'compact-summary', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: 'COMPACT_DONE', annotations: [] }] })
        return
      }
      assert.deepEqual(parsed['reasoning'], requests.length <= 2 ? { effort: 'high', summary: 'auto' }
        : requests.length === 3 ? { effort: 'low', summary: 'auto' }
          : requests.length === 4 ? { effort: 'max', summary: 'auto' } : { effort: 'none' })
      const input = parsed['input'] as Record<string, unknown>[]
      const last = input.at(-1)
      if (last?.['type'] === 'function_call_output') {
        assert.match(String(last['output']), /native-echo/u)
        assert.match(String(last['output']), /Script completed/u)
        respond(response, { type: 'message', id: 'reply-mcp', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'MCP_DONE', annotations: [] }] })
      } else {
        const latest = JSON.stringify(last)
        if (latest.includes('CHAT_FIRST')) {
          assert.ok((parsed['tools'] as { name: string }[]).some((tool) => tool.name === 'codemode'))
          respond(response, { type: 'function_call', id: 'fc_native', call_id: 'call_native', name: 'codemode', status: 'completed', arguments: JSON.stringify({ code: 'text(await tools.mcp__fixture__echo({value:"native-echo"}));' }) })
        } else if (latest.includes('AFTER_NEW')) {
          assert.ok(!body.includes('CHAT_FIRST') && !body.includes('MCP_DONE'), 'A new native session must start with new model history')
          respond(response, { type: 'message', id: 'reply-new', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'NEW_DONE', annotations: [] }] })
        } else {
          assert.ok(body.includes('CHAT_FIRST') && body.includes('MCP_DONE'), 'Both input surfaces must share model history')
          const text = latest.includes('TUI_SECOND') ? 'TUI_DONE' : latest.includes('CHAT_THIRD') ? 'CHAT_DONE' : ''
          assert.ok(text, `Unexpected latest input: ${latest}`)
          respond(response, { type: 'message', id: `reply-${sequence}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] })
        }
      }
    } catch (error) { modelError = error instanceof Error ? error : new Error(String(error)); response.writeHead(500); response.end('Fixture assertion failed') }
  })
})
let terminals: TmuxTerminalService | undefined
const sessionId = randomUUID()
const ref = { provider: 'pi', id: sessionId } as const
let key = SessionTerminals.key(ref)
let harness: InstanceType<typeof AgentHarness> | undefined
const frames: StreamFrame[] = []
const recorder = new MemoryDataRecorder()
async function waitUntil(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (!await check()) {
    if (modelError) throw modelError
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`)
    await delay(50)
  }
}
async function collect(): Promise<void> {
  const telemetry = await readPiTerminalTelemetry(scratchDir, offset)
  offset = telemetry.offset
  events.push(...telemetry.events)
}
async function waitForRuns(count: number): Promise<void> {
  await waitUntil(async () => { await collect(); return events.filter((item) => item.event.type === 'run.completed').length >= count }, `${count} completed runs`)
  assert.equal(events.filter((item) => item.event.type === 'run.failed').length, 0)
}
try {
  const cwd = join(root, 'workspace')
  await mkdir(join(cwd, '.pi'), { recursive: true })
  await mkdir(join(cwd, '.git'))
  await mkdir(agentDir)
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ quietStartup: true, hideThinkingBlock: true, compaction: { keepRecentTokens: 1 } }))
  new ProjectTrustStore(agentDir).set(cwd, true)
  await writeFile(join(cwd, '.pi/mcp.json'), JSON.stringify({ mcpServers: { fixture: {
    command: process.execPath, args: ['--import', import.meta.resolve('tsx'), resolve('tests/fixtures/resources/mcp-server.ts')],
    exposure: 'codemode', toolExposure: { second: 'hidden' },
  } } }))
  const tmuxBinary = join(root, 'tmux-isolated')
  await writeFile(tmuxBinary, '#!/bin/sh\nexec tmux -f /dev/null "$@"\n', { mode: 0o700 })
  terminals = new TmuxTerminalService({ rootDir: join(root, 'terminals'), tmuxBinary, sweepIntervalMs: 0 })
  scratchDir = await terminals.scratchDir(key)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  let spec: ProviderRunSpec = { provider: 'pi', cwd, model: 'deepseek-flash', effort: 'high', baseUrl: `http://127.0.0.1:${address.port}`, authToken: 'fixture-only' }
  const provider = new PiProvider(new CodingAgentSessionFactory(agentDir), new PiSessionStore({ agentDir }), agentDir)
  provider.terminalLaunch = async (target, launchSpec, context) => {
    const launch = await piTerminalLaunch(agentDir, target, launchSpec, context)
    return { ...launch, env: { ...launch.env, HOME: root, XDG_CONFIG_HOME: join(root, '.config') } }
  }
  const providers = { pi: provider, claude: new ClaudeProvider({ globalConfigDir: join(root, 'claude') }) }
  const sessions = new SessionTerminals({ providers, terminals })
  harness = new AgentHarness({ providers, cwd, recorder })
  harness.configureTerminalChats(sessions, () => 'http://127.0.0.1/unused-native-pi-hooks')
  harness.sessionStream(ref).subscribe((frame) => frames.push(frame))
  await harness.openTerminal({ kind: 'new', provider: 'pi', sessionId }, spec, { cols: 120, rows: 36 })
  await waitUntil(async () => (await readPiTerminalJson<{ ready?: boolean }>(scratchDir, 'control'))?.ready === true, 'native TUI ready')
  assert.deepEqual((await readPiTerminalJson<TerminalStatus>(scratchDir, 'status'))?.effortLevels, ['off', 'low', 'high', 'max'])
  assert.equal((await readPiTerminalJson<TerminalStatus>(scratchDir, 'status'))?.effort, 'high')
  // Native /compact does not start an agent run. Its failure still has to reach Chat.
  await terminals.paste(key, '/compact')
  await terminals.sendKeys(key, ['Enter'])
  await waitUntil(() => frames.some((frame) => frame.type === 'session.compaction_failed'), 'Terminal-only compact failure in Chat')
  await collect()
  assert.deepEqual(events.filter((item) => item.event.type.startsWith('session.compact')).map((item) => item.event.type), ['session.compacting', 'session.compaction_failed'])
  assert.ok(events.every((item) => item.runId === undefined))
  assert.equal(requests.length, 0, 'Empty compaction must not call the model')
  await harness.configureTerminal(ref, { ...spec, model: 'unknown-fixture-model' }, 'unknown-model')
  await waitUntil(async () => (await readPiTerminalJson<TerminalStatus>(scratchDir, 'status'))?.model === 'unknown-fixture-model', 'unknown model configured')
  assert.deepEqual((await readPiTerminalJson<TerminalStatus>(scratchDir, 'status'))?.effortLevels, ['off'])
  assert.equal((await readPiTerminalJson<TerminalStatus>(scratchDir, 'status'))?.effort, 'off')
  await harness.configureTerminal(ref, spec, 'restore-deepseek')
  await waitUntil(async () => (await readPiTerminalJson<TerminalStatus>(scratchDir, 'status'))?.effort === 'high', 'DeepSeek capability restored')
  await harness.submitTerminal(ref, { text: 'CHAT_FIRST' }, spec, 'chat-first')
  await waitForRuns(1)
  await waitUntil(async () => (await terminals?.capture(key))?.includes('MCP_DONE') ?? false, 'Chat reply in TUI')
  spec = { ...spec, effort: 'low' }
  await harness.configureTerminal(ref, spec, 'effort-low')
  await waitUntil(async () => (await readPiTerminalJson<TerminalStatus>(scratchDir, 'status'))?.effort === 'low', 'Chat effort applied in TUI')
  await terminals.paste(key, 'TUI_SECOND')
  await terminals.sendKeys(key, ['Enter'])
  await waitForRuns(2)
  // Pi's native Shift+Tab cycles low → high → max. This must update Chat and the saved host spec.
  await terminals.sendKeys(key, ['BTab', 'BTab'])
  await waitUntil(async () => (await readPiTerminalJson<TerminalStatus>(scratchDir, 'status'))?.effort === 'max', 'TUI effort mirrored to Chat')
  assert.equal((await readPiTerminalJson<ProviderRunSpec>(scratchDir, 'spec'))?.effort, 'max')
  spec = { ...spec, effort: 'max' }
  await harness.submitTerminal(ref, { text: 'CHAT_THIRD' }, spec, 'chat-third')
  await waitForRuns(3)
  const starts = events.filter((item) => item.event.type === 'run.started')
  assert.equal(starts.length, 3)
  assert.deepEqual(starts.map((item) => item.event.type === 'run.started' ? item.event.userMessage?.content : undefined), ['CHAT_FIRST', 'TUI_SECOND', 'CHAT_THIRD'])
  assert.deepEqual([...new Set(events.map((item) => item.sessionId))], [sessionId])
  assert.ok(events.some((item) => item.event.type === 'tool.started' && item.event.name === 'mcp__fixture__echo' && item.event.parentToolCallId))
  const savedSessions = await SessionManager.list(cwd, piSessionBucketDir(agentDir, cwd))
  assert.equal(savedSessions.length, 1)
  const file = savedSessions[0]?.path
  assert.ok(file)
  const transcript = SessionManager.open(file).getEntries()
  const userMessages = transcript.filter((item) => item.type === 'message' && item.message.role === 'user')
  assert.equal(userMessages.length, 3)
  assert.equal(requests.length, 4)
  await waitUntil(() => frames.filter((frame) => frame.type === 'run.completed').length === 3, 'parent driver completions')
  assert.equal(frames.filter((frame) => frame.type === 'run.failed').length, 0)
  assert.ok(frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'chat-first'))
  assert.ok(frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'chat-third'))
  assert.ok(frames.some((frame) => frame.type === 'tool.started' && frame.name === 'mcp__fixture__echo' && frame.parentToolCallId))
  const snapshot = harness.sessionStream(ref).snapshot()
  assert.equal(snapshot.activeRunId, undefined)
  assert.deepEqual(snapshot.messages.filter((message) => message.role === 'user' && !message.compact).map((message) => message.content), ['CHAT_FIRST', 'TUI_SECOND', 'CHAT_THIRD'])
  assert.equal(recorder.ofKind('run.finished').length, 3)
  await harness.disposePool()
  harness = new AgentHarness({ providers, cwd, recorder })
  harness.configureTerminalChats(new SessionTerminals({ providers, terminals }), () => 'http://127.0.0.1/unused-native-pi-hooks')
  harness.sessionStream(ref).subscribe((frame) => frames.push(frame))
  const adopted = await harness.openTerminal({ kind: 'resume', session: ref }, spec, { cols: 120, rows: 36 })
  assert.equal(adopted.adopted, true)
  assert.equal(recorder.ofKind('run.finished').length, 3, 'Adopting an idle native session must not re-account completed turns')
  assert.equal(frames.filter((frame) => frame.type === 'run.completed').length, 3)
  spec = { ...spec, effort: 'off' }
  await harness.configureTerminal(ref, spec, 'effort-off')
  await harness.submitTerminal(ref, { text: '/new' }, spec, 'chat-new')
  await waitUntil(() => frames.some((frame) => frame.type === 'session.rebound'), 'native /new parent rebind')
  const rebound = frames.find((frame) => frame.type === 'session.rebound')
  assert.ok(rebound?.type === 'session.rebound')
  assert.notEqual(rebound.nextSessionId, ref.id)
  assert.ok(frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'chat-new'))
  assert.equal(frames.filter((frame) => frame.type === 'run.aborted').length, 0)
  const nextRef = { ...ref, id: rebound.nextSessionId }
  key = SessionTerminals.key(nextRef)
  harness.sessionStream(nextRef).subscribe((frame) => frames.push(frame))
  await harness.submitTerminal(nextRef, { text: 'AFTER_NEW' }, spec, 'chat-after-new')
  await waitUntil(() => frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'chat-after-new'), 'Chat after native /new')
  assert.equal(frames.filter((frame) => frame.type === 'run.failed').length, 0)
  assert.equal(requests.length, 5)
  const nextSnapshot = harness.sessionStream(nextRef).snapshot()
  assert.equal(nextSnapshot.activeRunId, undefined)
  assert.deepEqual(nextSnapshot.messages.filter((message) => message.role === 'user').map((message) => message.content), ['AFTER_NEW'])
  assert.ok(nextSnapshot.messages.some((message) => message.role === 'assistant' && message.content === 'NEW_DONE'))
  assert.equal((await SessionManager.list(cwd, piSessionBucketDir(agentDir, cwd))).length, 2)
  assert.equal(recorder.ofKind('run.finished').length, 5)
  assert.equal(new Set(recorder.ofKind('run.finished').map((record) => record.runId)).size, 5)
  await waitUntil(async () => (await terminals?.capture(key))?.includes('NEW_DONE') ?? false, 'new Chat reply in rebound TUI')
  const beforeCompaction = requests.length
  compactionResponse = 'wait'
  await harness.submitTerminal(nextRef, { text: '/compact' }, spec, 'chat-compact-cancel')
  await waitUntil(() => requests.length > beforeCompaction, 'manual compaction request before cancellation')
  assert.equal(await harness.abortTerminal(nextRef, 'chat-compact-cancel'), true)
  await waitUntil(() => frames.some((frame) => frame.type === 'run.aborted' && frame.runId === 'chat-compact-cancel'), 'manual compact cancellation outcome')
  assert.ok(frames.some((frame) => frame.type === 'session.compaction_cancelled' && frame.reason === 'manual' && frame.runId === 'chat-compact-cancel'))
  assert.deepEqual(frames.filter((frame) => frame.runId === 'chat-compact-cancel' && ['run.completed', 'run.failed', 'run.aborted'].includes(frame.type))
    .map((frame) => frame.type), ['run.aborted'])
  compactionResponse = 'success'
  await harness.submitTerminal(nextRef, { text: '/compact' }, spec, 'chat-compact-success')
  await waitUntil(() => frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'chat-compact-success'), 'manual compact success outcome')
  assert.ok(frames.some((frame) => frame.type === 'session.compacted' && frame.reason === 'manual' && frame.runId === 'chat-compact-success' && frame.summary?.includes('COMPACT_DONE')))
  const afterCompaction = requests.length
  await harness.submitTerminal(nextRef, { text: '/compact' }, spec, 'chat-compact-failed')
  await waitUntil(() => frames.some((frame) => frame.type === 'run.failed' && frame.runId === 'chat-compact-failed'), 'manual compact rejection outcome')
  assert.ok(frames.some((frame) => frame.type === 'session.compaction_failed' && frame.reason === 'manual' && frame.runId === 'chat-compact-failed'))
  assert.equal(requests.length, afterCompaction, 'Already compacted rejection must not call the model')
  assert.deepEqual(frames.filter((frame) => frame.runId === 'chat-compact-failed' && ['run.completed', 'run.failed', 'run.aborted'].includes(frame.type))
    .map((frame) => frame.type), ['run.failed'])
  await terminals.paste(key, '/quit')
  await terminals.sendKeys(key, ['Enter'])
  await waitUntil(async () => !await terminals?.isAlive(key), 'native exit')
  assert.equal((await readPiTerminalJson<{ phase: string }>(scratchDir, 'state'))?.phase, 'exited')
  const restored = await new CodingAgentSessionFactory(agentDir).open({ ...spec, effort: 'medium' }, { kind: 'resume', session: nextRef })
  try {
    assert.equal(restored.native.thinkingLevel, 'off', 'A saved native thinking level must win over the Chat default during cold resume')
  } finally { await restored.dispose() }
  process.stdout.write('Pi native TUI: shared Chat/TUI transcript, native thinking levels with explicit Responses off, MCP via Codemode, nested events, parent restart adoption without duplicate accounting, /new rebind, Terminal compaction failure and Chat compaction cancellation/success/failure, clean exit passed\n')
} catch (error) {
  if (terminals && await terminals.isAlive(key)) process.stderr.write(`Pi terminal screen:\n${await terminals.capture(key)}\n`)
  process.stderr.write(`Pi terminal event types: ${events.map((item) => item.event.type).join(', ')}\n`)
  throw error
} finally {
  await harness?.disposePool()
  await terminals?.close(key)
  await terminals?.dispose()
  server.closeAllConnections()
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
