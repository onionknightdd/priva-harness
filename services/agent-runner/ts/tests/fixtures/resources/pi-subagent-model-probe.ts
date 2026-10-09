import type * as PiLoader from '../../../src/provider/pi/pi-resource-loader.js'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Isolate native configuration and send all model requests to the local fixture.
const root = await realpath(await mkdtemp(join(os.tmpdir(), 'pi-subagent-model-')))
os.homedir = () => root
syncBuiltinESMExports()
const agentDir = join(root, 'agent')
process.env['PI_CODING_AGENT_DIR'] = agentDir
process.env['CLAUDE_CONFIG_DIR'] = join(root, 'claude')
process.env['PI_CODE_DISABLE_AUTO_MEMORY'] = '1'
const { createAgentSession, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent')
const { createPiResourceLoader } = await import(pathToFileURL(resolve(process.argv[2] ?? 'src/provider/pi/pi-resource-loader.ts')).href) as typeof PiLoader
const { buildPiModelsConfig } = await import('../../../src/provider/pi/pi-models-config.js')
const requests: string[] = []
const sessions = []
const server = createServer((request, response) => {
  request.setEncoding('utf8')
  let body = ''
  request.on('data', (chunk: string) => { body += chunk })
  request.on('end', () => {
    requests.push((JSON.parse(body) as { model: string }).model)
    const item = { type: 'message', id: 'msg', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }
    const events = [
      { type: 'response.created', response: { id: 'resp', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'OK' },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: 'resp', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11, input_tokens_details: { cached_tokens: 0 } } } },
    ]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  })
})
try {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const provider = buildPiModelsConfig(`http://127.0.0.1:${address.port}`, 'main-first', 'fixture-token').providers.openai
  const modelConfig = (id: string) => ({ ...provider.models[0], id, name: id })
  const modelsPath = join(root, 'models.json')
  await writeFile(modelsPath, JSON.stringify({ providers: {
    openai: { ...provider, models: ['main-first', 'main-second', 'custom-pinned'].map(modelConfig) },
    anthropic: { ...provider, models: [modelConfig('claude-haiku-4-5')] },
  } }))
  const modelRuntime = await ModelRuntime.create({ modelsPath, authPath: join(root, 'auth.json'), modelsStorePath: join(root, 'catalog.json') })
  // A missing Anthropic credential would hide the Explore regression by causing fallback.
  assert.ok((await modelRuntime.getAvailable('anthropic')).some((model) => model.id === 'claude-haiku-4-5'))
  const cwd = join(root, 'work')
  await mkdir(join(cwd, '.pi/agents'), { recursive: true })
  await writeFile(join(cwd, '.pi/subagents.json'), JSON.stringify({ rememberAgents: false, outputTranscript: false, schedulingEnabled: false }))
  for (const [name, model] of [['unconfigured', undefined], ['pinned', 'openai/custom-pinned']]) {
    await writeFile(join(cwd, '.pi/agents', `${name}.md`), `---\nname: ${name}\ndescription: Model regression fixture\n${model ? `model: ${model}\n` : ''}---\nReply OK without tools.\n`)
  }
  const model = modelRuntime.getModel('openai', 'main-first')
  assert.ok(model)
  const settingsManager = SettingsManager.create(cwd, agentDir)
  const resourceLoader = await createPiResourceLoader(cwd, agentDir, settingsManager)
  const { session } = await createAgentSession({ cwd, agentDir, model, modelRuntime, settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(cwd) })
  sessions.push(session)
  await session.bindExtensions({ mode: 'rpc' })
  const delegate = async (agent: string, expected: string, selectedModel?: string) => {
    const tool = session.agent.state.tools.find((tool) => tool.name === 'Agent')
    assert.ok(tool)
    requests.length = 0
    const result = await tool.execute(`check-${agent}`, { subagent_type: agent, description: `Check ${agent}`, prompt: 'Reply OK without tools.',
      run_in_background: false, ...(selectedModel ? { model: selectedModel } : {}) })
    assert.deepEqual(requests, [expected], `${agent}: ${JSON.stringify(result.content)}`)
  }
  for (const id of ['main-first', 'main-second']) {
    const current = modelRuntime.getModel('openai', id)
    assert.ok(current)
    await session.setModel(current)
    for (const agent of ['Explore', 'Plan', 'general-purpose', 'unconfigured']) await delegate(agent, id)
    await delegate('pinned', 'custom-pinned')
    await delegate('unconfigured', 'custom-pinned', 'openai/custom-pinned')
  }
  // A custom definition may replace a built-in without losing its model.
  await writeFile(join(cwd, '.pi/agents/Explore.md'), '---\nname: Explore\ndescription: Custom Explore\nmodel: openai/custom-pinned\n---\nReply OK without tools.\n')
  await delegate('Explore', 'custom-pinned')
  process.stdout.write('Pi subagents: default inheritance, custom overrides and warm model switches passed\n')
} finally {
  for (const session of sessions) {
    await session.abort()
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    session.dispose()
  }
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await rm(root, { recursive: true, force: true })
}
