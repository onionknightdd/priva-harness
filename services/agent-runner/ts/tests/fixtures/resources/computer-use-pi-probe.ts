// Checks the computer-use plugin inside a real Pi session, using the runtime installed in the plugin.
// Run in a separate process so SDK discovery never reads the user's Pi files.
//
//   node --import tsx tests/fixtures/resources/computer-use-pi-probe.ts            lists applications only
//   node --import tsx tests/fixtures/resources/computer-use-pi-probe.ts <app>      also tries to open <app> and reports what happened
import assert from 'node:assert/strict'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [app, ...extra] = process.argv.slice(2)
if (extra.length > 0) throw new Error('Usage: computer-use-pi-probe.ts [application]')

const root = await realpath(await mkdtemp(join(os.tmpdir(), 'priva-pi-computer-use-')))
// Only this process sees the redirected home; the desktop workers keep the real HOME they inherit.
os.homedir = () => root
syncBuiltinESMExports()
const agentDir = join(root, 'agent')
process.env['PI_CODING_AGENT_DIR'] = agentDir
const { SettingsManager, createAgentSession, SessionManager } = await import('@earendil-works/pi-coding-agent')
const { createPiResourceLoader } = await import('../../../src/provider/pi/pi-resource-loader.js')
const { enabledPluginMcpServers } = await import('../../../src/core/plugin/plugin-mcp.js')

const cwd = join(root, 'workspace')
await mkdir(cwd, { recursive: true })
await mkdir(agentDir, { recursive: true })
await writeFile(join(agentDir, 'settings.json'), '{}')
const settingsManager = SettingsManager.create(cwd, agentDir)
const loader = await createPiResourceLoader(cwd, agentDir, settingsManager, undefined, [], [], ['computer-use'])
assert.deepEqual(loader.getExtensions().errors, [])
assert.ok(loader.getSkills().skills.some((skill) => skill.name === 'computer-use'), 'Pi did not discover the computer-use skill')
const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) })
try {
  await session.bindExtensions({ mode: 'rpc' })
  // Pi registers hidden tools without making them reachable; the model is offered the active set.
  const names = () => session.agent.state.tools.map((tool) => tool.name)
  const deadline = Date.now() + 30_000
  while (!names().includes('mcp__cua_repl__js') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  for (const tool of ['mcp__cua_repl__js', 'mcp__cua_repl__js_reset', 'mcp__node_repl__js']) assert.ok(names().includes(tool), `Pi does not offer ${tool}`)
  const hidden = enabledPluginMcpServers(['computer-use']).flatMap((server) => server.hiddenTools.map((tool) => `mcp__${server.name}__${tool}`))
  for (const tool of hidden) assert.ok(!names().includes(tool), `Pi offers the host-only tool ${tool}`)

  const tool = session.agent.state.tools.find((candidate) => candidate.name === 'mcp__cua_repl__js')
  assert.ok(tool, 'mcp__cua_repl__js is not an active tool')
  const call = async (id: string, title: string, code: string) => {
    // Supply the issuing assistant message without making a model request.
    session.agent.state.messages = [...session.agent.state.messages, {
      role: 'assistant', content: [{ type: 'toolCall', id, name: tool.name, arguments: { title, code } }],
      api: 'openai-responses', provider: 'fixture', model: 'fixture', stopReason: 'toolUse', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }]
    try {
      const result = await tool.execute(id, { title, code })
      return { failed: false, text: result.content.flatMap((item) => item.type === 'text' ? [item.text] : []).join('\n') }
    } catch (error) {
      return { failed: true, text: error instanceof Error ? error.message : String(error) }
    }
  }
  const inventory = await call('inventory', 'Listing applications', 'await cua.getState();')
  assert.equal(inventory.failed, false, inventory.text.slice(0, 1024))
  assert.ok(inventory.text.includes('## Computer Use'), 'The first call did not return the runtime documentation')
  const report: Record<string, unknown> = { skill: 'computer-use', offered: names().filter((name) => name.startsWith('mcp__')).sort(), hidden, inventory: 'ok' }
  if (app !== undefined) {
    const opened = await call('open-application', `Opening ${app}`, `let app = await cua.getApp(${JSON.stringify(app)});`)
    const interfaceLines = opened.text.split('\n').filter((line) => /^\s*\d+\s+\S/u.test(line)).length
    report['application'] = opened.failed || interfaceLines === 0
      ? { opened: false, message: opened.text.split('\n')[0]?.slice(0, 240) }
      : { opened: true, interfaceLines }
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  await session.abort()
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
  session.dispose()
  await rm(root, { recursive: true, force: true })
}
