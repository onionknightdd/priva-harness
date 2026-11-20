// Checks the computer-use plugin against the runtime installed in its own directory.
//
//   runtime          Starts both declared MCP servers. Does not touch any application.
//   session [app]    Runs a real Claude SDK session against a local model fixture that calls
//                    cua_repl once. Without an application it lists what the desktop has, which
//                    works on every platform. With one it opens that application by name and
//                    reads its interface back, which is the macOS form. It sends no input.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import Fastify, { type FastifyReply } from 'fastify'
import { enabledPluginMcpServers, type PluginMcpServer } from '../../../src/core/plugin/plugin-mcp.js'
import { ClaudeRuntime } from '../../../src/provider/claude/claude-runtime.js'
import { testRunSpec } from '../../support/run-spec.js'

const PLUGIN = 'computer-use'
const timeout = { timeout: 60_000 }

interface ToolDefinition { name: string; inputSchema: Record<string, unknown> }

async function withServer<T>(server: PluginMcpServer, run: (client: Client, tools: ToolDefinition[]) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: server.command, args: [...server.args], stderr: 'pipe',
    env: { HOME: homedir(), PATH: process.env['PATH'] ?? '', TMPDIR: tmpdir(), ...server.env },
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-1024) })
  const client = new Client({ name: 'priva-computer-use-probe', version: '1.0.0' })
  try {
    await client.connect(transport, timeout)
    const { tools } = await client.listTools({}, timeout)
    return await run(client, tools)
  } catch (error) {
    throw new Error(`${server.name}: ${error instanceof Error ? error.message : String(error)}${stderr.trim() ? `\n${stderr.trim()}` : ''}`, { cause: error })
  } finally {
    await client.close()
    await transport.close()
  }
}

async function js(client: Client, code: string): Promise<string> {
  const response = await client.callTool({ name: 'js', arguments: { title: 'Checking the runtime', code } }, timeout)
  const content = response.content as { type: string; text?: string }[]
  const text = content.flatMap((part) => part.type === 'text' && part.text !== undefined ? [part.text] : []).join('\n')
  assert.notEqual(response.isError, true, text.slice(0, 1024))
  return text
}

async function checkRuntime(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {}
  for (const server of enabledPluginMcpServers([PLUGIN])) {
    result[server.name] = await withServer(server, async (client, definitions) => {
      const tools = definitions.map((tool) => tool.name)
      for (const tool of ['js', 'js_reset', ...server.hiddenTools]) assert.ok(tools.includes(tool), `${server.name} does not provide ${tool}`)
      // Claude drops a tool whose input schema combines alternatives at the top level.
      for (const tool of definitions.filter((definition) => !server.hiddenTools.includes(definition.name))) {
        for (const keyword of ['oneOf', 'anyOf', 'allOf']) assert.ok(!(keyword in tool.inputSchema), `${server.name}.${tool.name} has a top-level ${keyword} schema`)
      }
      // Its `js` needs a connected device; the tool list is what can be checked here.
      if (server.name === 'registered_computers') return { tools, hidden: server.hiddenTools }
      if (server.name === 'cua_repl') {
        assert.ok((await js(client, 'nodeRepl.write(typeof cua.getApp);')).split(/\r?\n/u).includes('function'), 'cua.getApp is not preloaded')
        return { tools, hidden: server.hiddenTools, preloaded: 'cua.getApp' }
      }
      await js(client, 'const probeBinding = { sequence: 6 };')
      assert.ok((await js(client, 'nodeRepl.write("binding-" + (probeBinding.sequence + 1));')).includes('binding-7'), 'bindings did not persist')
      return { tools, hidden: server.hiddenTools, persistentBindings: true }
    })
  }
  return result
}

interface ModelRequest { model: string; stream?: boolean; tools?: { name?: string }[]; messages: { role: string; content: unknown }[] }

function reply(body: ModelRequest, response: FastifyReply, content: Record<string, unknown>[]): unknown {
  const stop_reason = content.some((block) => block['type'] === 'tool_use') ? 'tool_use' : 'end_turn'
  const message = { id: `probe-${randomUUID()}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason,
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
  return response.type('text/event-stream').send(events.map((event) => `event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}

async function checkSession(app: string | undefined): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), 'priva-computer-use-probe-'))
  const configDir = join(root, 'claude')
  await mkdir(configDir)
  // The user's Claude configuration stays untouched. HOME stays real: the desktop service is found through it.
  Object.assign(process.env, { CLAUDE_CONFIG_DIR: configDir, ENABLE_TOOL_SEARCH: 'false',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' })
  const model = Fastify()
  const advertised = new Set<string>()
  const toolUseId = 'open-application'
  let asked = false
  let toolResult: { text: string; isError: boolean } | undefined
  let skillListed = false
  model.post('/v1/messages/count_tokens', () => ({ input_tokens: 10 }))
  model.post('/v1/messages', (request, response) => {
    const body = request.body as ModelRequest
    for (const tool of body.tools ?? []) if (tool.name) advertised.add(tool.name)
    if (JSON.stringify(body).includes(`${PLUGIN}:${PLUGIN}`)) skillListed = true
    for (const message of body.messages) {
      if (!Array.isArray(message.content)) continue
      for (const block of message.content as { type?: string; tool_use_id?: string; is_error?: boolean; content?: unknown }[]) {
        if (block.type !== 'tool_result' || block.tool_use_id !== toolUseId || toolResult) continue
        const parts = Array.isArray(block.content) ? block.content as { type?: string; text?: string }[] : [{ type: 'text', text: String(block.content) }]
        toolResult = { isError: block.is_error === true, text: parts.flatMap((part) => part.type === 'text' && part.text ? [part.text] : []).join('\n') }
      }
    }
    if (!asked && (body.tools ?? []).some((tool) => tool.name === 'mcp__cua_repl__js')) {
      asked = true
      return reply(body, response, [{ type: 'tool_use', id: toolUseId, name: 'mcp__cua_repl__js',
        input: app === undefined ? { title: 'Listing applications', code: 'await cua.getState();' }
          : { title: `Opening ${app}`, code: `let app = await cua.getApp(${JSON.stringify(app)});` } }])
    }
    return reply(body, response, [{ type: 'text', text: 'Done.' }])
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  let runtime: ClaudeRuntime | undefined
  try {
    const baseUrl = await model.listen({ host: '127.0.0.1', port: 0 })
    const spec = testRunSpec({ cwd: root, model: 'claude-sonnet-4-6', baseUrl, authToken: 'fixture-token',
      promptSuggestions: false, enabledPluginIds: [PLUGIN] })
    runtime = new ClaudeRuntime(spec, { kind: 'new', provider: 'claude', sessionId: randomUUID() }, configDir,
      (args) => query({ ...args, options: { ...args.options, persistSession: false, strictMcpConfig: true } }))
    const asks: string[] = []
    const failures: string[] = []
    for await (const event of runtime.run({ text: 'Use the desktop.' }, { signal: controller.signal })) {
      if (event.type === 'run.failed' || event.type === 'error') failures.push(JSON.stringify(event).slice(0, 600))
      if (event.type === 'permission.requested') asks.push(event.request.tool)
    }
    const seen = `Model was offered: ${[...advertised].filter((tool) => tool.startsWith('mcp__')).join(', ') || 'no MCP tools'}. ${failures.join(' ')}`
    assert.ok(asked, `The session never offered mcp__cua_repl__js to the model. ${seen}`)
    assert.deepEqual(asks, [], 'The session asked the user although applications are used without asking')
    if (!toolResult) throw new Error(`The model never received the tool result. ${seen}`)
    assert.equal(toolResult.isError, false, toolResult.text.slice(0, 1024))
    assert.ok(toolResult.text.includes('## Computer Use'), 'The first call did not return the runtime documentation')
    const interfaceLines = toolResult.text.split('\n').filter((line) => /^\s*\d+\s+\S/u.test(line))
    if (app !== undefined) assert.ok(interfaceLines.length > 0, 'The tool result did not contain the application interface')
    for (const tool of ['mcp__cua_repl__js', 'mcp__cua_repl__js_reset', 'mcp__node_repl__js']) assert.ok(advertised.has(tool), `Model was not offered ${tool}`)
    const hidden = enabledPluginMcpServers([PLUGIN]).flatMap((server) => server.hiddenTools.map((tool) => `mcp__${server.name}__${tool}`))
    for (const tool of hidden) assert.ok(!advertised.has(tool), `Model was offered the host-only tool ${tool}`)
    assert.ok(skillListed, 'The session did not list the computer-use skill')
    return { userWasAsked: false, documentation: true,
      ...(app === undefined ? {} : { interfaceLines: interfaceLines.length, firstLine: interfaceLines[0]?.trim().slice(0, 120) }),
      offered: [...advertised].filter((tool) => tool.startsWith('mcp__')).sort(), hidden, skillListed }
  } finally {
    clearTimeout(timer)
    await runtime?.release('dispose')
    await model.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}

const [mode, app, ...extra] = process.argv.slice(2)
try {
  if (mode === 'runtime' && app === undefined) console.log(JSON.stringify(await checkRuntime(), null, 2))
  else if (mode === 'session' && extra.length === 0) console.log(JSON.stringify(await checkSession(app), null, 2))
  else throw new Error('Usage: computer-use-probe.ts runtime | session [application]')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
