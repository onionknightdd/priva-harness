import type * as PiResourceLoader from '../../../src/provider/pi/pi-resource-loader.js'
// Run in a separate process so SDK discovery never reads the user's Pi files.
import assert from 'node:assert/strict'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await realpath(await mkdtemp(join(os.tmpdir(), 'priva-pi-mcp-lifecycle-')))
os.homedir = () => root
syncBuiltinESMExports()
process.env['PI_CODING_AGENT_DIR'] = join(root, 'agent')
const { SettingsManager, createAgentSession, ProjectTrustStore, SessionManager } = await import('@earendil-works/pi-coding-agent')
const { createPiResourceLoader } = await import(pathToFileURL(resolve(process.argv[2] ?? 'src/provider/pi/pi-resource-loader.ts')).href) as typeof PiResourceLoader
const sessions = []
try {
  const agentDir = join(root, 'agent')
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'settings.json'), '{}')
  for (const name of ['project_a', 'project_b']) {
    const cwd = join(root, name)
    await mkdir(join(cwd, '.pi'), { recursive: true })
    await mkdir(join(cwd, '.git'))
    new ProjectTrustStore(agentDir).set(cwd, true)
    await writeFile(join(cwd, '.pi/mcp.json'), JSON.stringify({ mcpServers: { [name]: {
      command: process.execPath, args: ['--import', import.meta.resolve('tsx'), resolve('tests/fixtures/resources/mcp-server.ts')],
      exposure: 'codemode', toolExposure: { second: 'hidden' },
    } } }))
    const settingsManager = SettingsManager.create(cwd, agentDir)
    const loader = await createPiResourceLoader(cwd, agentDir, settingsManager)
    assert.deepEqual(loader.getExtensions().errors, [])
    const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) })
    sessions.push(session)
    const events: { type: string; toolName: string; parentToolCallId?: string }[] = []
    session.subscribe((event) => {
      if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') events.push(event)
    })
    await session.bindExtensions({ mode: 'rpc' })
    // Direct tool.execute calls bypass agent-loop startup waiting.
    const deadline = Date.now() + 10_000
    while (!session.getAllTools().some((tool) => tool.name === `mcp__${name}__echo`) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.ok(session.getAllTools().some((tool) => tool.name === `mcp__${name}__echo`))
    assert.equal(session.getAllTools().filter((tool) => tool.name === 'codemode').length, 1)
    assert.equal(session.getAllTools().some((tool) => tool.name === 'mcp' || tool.name === 'mcpScript'), false)
    const tool = session.agent.state.tools.find((tool) => tool.name === 'codemode')
    assert.ok(tool)
    const parent = `fixture-${name}`
    // Supply the issuing assistant message without making a model request.
    session.agent.state.messages = [...session.agent.state.messages, {
      role: 'assistant', content: [{ type: 'toolCall', id: parent, name: 'codemode', arguments: { code: 'fixture' } }],
      api: 'openai-responses', provider: 'fixture', model: 'fixture', stopReason: 'toolUse', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }]
    const result = await tool.execute(parent, { code: `text(await tools.mcp__${name}__echo({value: "${name}"}));` })
    const text = result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
    assert.ok(text.includes(name), text)
    assert.ok(text.includes(cwd), text)
    assert.match(text, /Script completed/u)
    assert.ok(events.some((event) => event.type === 'tool_execution_start' && event.toolName === `mcp__${name}__echo` && event.parentToolCallId === parent))
    assert.ok(events.some((event) => event.type === 'tool_execution_end' && event.toolName === `mcp__${name}__echo` && event.parentToolCallId === parent))
    for (const unavailable of [`mcp__${name}__second`, `mcp__${name === 'project_a' ? 'project_b' : 'project_a'}__echo`]) {
      const wrong = await tool.execute(`unavailable-${unavailable}`, { code: `text(await tools.${unavailable}({value:"wrong"}));` })
      const wrongText = wrong.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
      assert.match(wrongText, /does not exist/u)
    }
  }
  process.stdout.write('Pi MCP: isolated cwd, native codemode calls, hidden tools and nested events passed\n')
} finally {
  for (const session of sessions) {
    await session.abort()
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    session.dispose()
  }
  await rm(root, { recursive: true, force: true })
}
