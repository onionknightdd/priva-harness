import type * as PiLoader from '../../../src/provider/pi/pi-resource-loader.js'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
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
const { createAgentSession, createEventBus, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent')
const { createPiResourceLoader } = await import(pathToFileURL(resolve(process.argv[2] ?? 'src/provider/pi/pi-resource-loader.ts')).href) as typeof PiLoader
const { buildPiModelsConfig } = await import('../../../src/provider/pi/pi-models-config.js')
const { PiWorkflows } = await import('../../../src/provider/pi/pi-workflows.js')
const requests: string[] = []
const sessions: Awaited<ReturnType<typeof createAgentSession>>['session'][] = []
const workflows: InstanceType<typeof PiWorkflows>[] = []
const settingsFiles = new Map<string, string>()
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
  const provider = buildPiModelsConfig(`http://127.0.0.1:${address.port}`, 'main-first').providers['priva-chat']
  const modelConfig = (id: string) => ({ ...provider.models[0], id, name: id })
  const modelsPath = join(root, 'models.json')
  await writeFile(modelsPath, JSON.stringify({ providers: {
    'priva-chat': { ...provider, models: ['main-first', 'main-second', 'custom-pinned'].map(modelConfig) },
    anthropic: { ...provider, models: [modelConfig('claude-haiku-4-5')] },
  } }))
  const modelRuntime = await ModelRuntime.create({ modelsPath, authPath: join(root, 'auth.json'), modelsStorePath: join(root, 'catalog.json') })
  await modelRuntime.setRuntimeApiKey('priva-chat', 'fixture-token')
  await modelRuntime.setRuntimeApiKey('anthropic', 'fixture-token')
  // A missing Anthropic credential would hide the Explore regression by causing fallback.
  assert.ok((await modelRuntime.getAvailable('anthropic')).some((model) => model.id === 'claude-haiku-4-5'))
  const cwd = join(root, 'work')
  await mkdir(join(cwd, '.pi/agents'), { recursive: true })
  for (const [name, model] of [['unconfigured', undefined], ['pinned', 'priva-chat/custom-pinned']]) {
    await writeFile(join(cwd, '.pi/agents', `${name}.md`), `---\nname: ${name}\ndescription: Model regression fixture\n${model ? `model: ${model}\n` : ''}---\nReply OK without tools.\n`)
  }
  const model = modelRuntime.getModel('priva-chat', 'main-first')
  assert.ok(model)
  const openSession = async (cwd: string, workflowsEnabled?: boolean) => {
    await mkdir(join(cwd, '.pi'), { recursive: true })
    const path = join(cwd, '.pi/subagents.json')
    const original = `${JSON.stringify({ rememberAgents: false, outputTranscript: false, schedulingEnabled: false,
      ...(workflowsEnabled === undefined ? {} : { workflowsEnabled }) }, null, 2)}\n`
    settingsFiles.set(path, original)
    await writeFile(path, original)
    const bus = createEventBus()
    const settingsEvents: unknown[] = []
    bus.on('subagents:settings_loaded', (event) => settingsEvents.push(event))
    const settingsManager = SettingsManager.create(cwd, agentDir)
    const resourceLoader = await createPiResourceLoader(cwd, agentDir, settingsManager, bus)
    const manager = SessionManager.inMemory(cwd)
    const workflow = new PiWorkflows({ cwd, agentDir, sessionId: manager.getSessionId(), modelRuntime, providerId: 'priva-chat', modelId: model.id })
    workflows.push(workflow)
    const { session } = await createAgentSession({ cwd, agentDir, model, modelRuntime, settingsManager, resourceLoader,
      sessionManager: manager, customTools: [workflow.tool] })
    sessions.push(session)
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
    try {
      await session.bindExtensions({ mode: 'rpc', uiContext: { ...session.extensionRunner.getUIContext(),
        notify: (message, type) => { if (type === 'warning') warnings.push(message) },
      } })
    } finally { console.warn = originalWarn }
    assert.ok(!warnings.some((message) => /Another extension.*workflow/iu.test(message)), `Workflow collision with workflowsEnabled=${String(workflowsEnabled)}: ${warnings.join('\n')}`)
    assert.equal(settingsEvents.length, 1)
    assert.equal((settingsEvents[0] as { settings: { workflowsEnabled?: boolean } }).settings.workflowsEnabled, false)
    const tools = session.getAllTools()
    assert.equal(tools.filter((tool) => tool.name === 'workflow').length, 1)
    assert.equal(tools.find((tool) => tool.name === 'workflow')?.sourceInfo.source, 'sdk')
    assert.ok(tools.some((tool) => tool.name === 'Agent'))
    assert.ok(!tools.some((tool) => tool.name === 'SubagentWorkflow'))
    assert.equal(await readFile(path, 'utf8'), original)
    return session
  }
  const session = await openSession(cwd)
  await openSession(join(root, 'explicit-workflow'), true)
  const delegate = async (agent: string, expected: string, selectedModel?: string) => {
    const tool = session.agent.state.tools.find((tool) => tool.name === 'Agent')
    assert.ok(tool)
    requests.length = 0
    const result = await tool.execute(`check-${agent}`, { subagent_type: agent, description: `Check ${agent}`, prompt: 'Reply OK without tools.',
      run_in_background: false, ...(selectedModel ? { model: selectedModel } : {}) })
    assert.deepEqual(requests, [expected], `${agent}: ${JSON.stringify(result.content)}`)
  }
  for (const id of ['main-first', 'main-second']) {
    const current = modelRuntime.getModel('priva-chat', id)
    assert.ok(current)
    await session.setModel(current)
    for (const agent of ['Explore', 'Plan', 'general-purpose', 'unconfigured']) await delegate(agent, id)
    await delegate('pinned', 'custom-pinned')
    await delegate('unconfigured', 'custom-pinned', 'priva-chat/custom-pinned')
  }
  // A custom definition may replace a built-in without losing its model.
  await writeFile(join(cwd, '.pi/agents/Explore.md'), '---\nname: Explore\ndescription: Custom Explore\nmodel: priva-chat/custom-pinned\n---\nReply OK without tools.\n')
  await delegate('Explore', 'custom-pinned')
  for (const [path, original] of settingsFiles) assert.equal(await readFile(path, 'utf8'), original)
  process.stdout.write('Pi subagents: default inheritance, custom overrides and warm model switches passed\n')
  process.stdout.write('Pi subagents: native workflow disabled before registration for unset/true settings; SDK workflow binds without collision and project settings remain unchanged\n')
} finally {
  for (const session of sessions) {
    await session.abort()
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    session.dispose()
  }
  for (const workflow of workflows) workflow.dispose()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await rm(root, { recursive: true, force: true })
}
