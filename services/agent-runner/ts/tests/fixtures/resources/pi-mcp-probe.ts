import type * as PiResourceLoader from '../../../src/provider/pi/pi-resource-loader.js'
// Run in a separate process so all SDK/adapter home discovery uses a disposable fixture.
import assert from 'node:assert/strict'
import os from 'node:os'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await realpath(await mkdtemp(join(os.tmpdir(), 'priva-pi-mcp-lifecycle-')))
os.homedir = () => root
syncBuiltinESMExports()
process.env['PI_CODING_AGENT_DIR'] = join(root, 'agent')
const { SettingsManager, createAgentSession, SessionManager } = await import('@earendil-works/pi-coding-agent')
const { createPiResourceLoader } = await import(pathToFileURL(resolve(process.argv[2] ?? 'src/provider/pi/pi-resource-loader.ts')).href) as typeof PiResourceLoader
const sessions = []
try {
  const agentDir = join(root, 'agent')
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ packages: [dirname(createRequire(import.meta.url).resolve('pi-mcp-adapter'))] }))
  for (const name of ['project-a', 'project-b']) {
    const cwd = join(root, name)
    await mkdir(join(cwd, '.pi'), { recursive: true })
    await mkdir(join(cwd, '.git'))
    await writeFile(join(cwd, '.pi/mcp.json'), JSON.stringify({ mcpServers: { [name]: { command: process.execPath, args: ['--import', import.meta.resolve('tsx'), resolve('tests/fixtures/resources/mcp-server.ts')], lifecycle: 'eager' } } }))
    const settingsManager = SettingsManager.create(cwd, agentDir)
    const loader = await createPiResourceLoader(cwd, agentDir, settingsManager)
    assert.deepEqual(loader.getExtensions().errors, [])
    const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) })
    sessions.push(session)
    await session.bindExtensions({ mode: 'rpc' })
    assert.equal(session.getAllTools().filter((tool) => tool.name === 'mcp').length, 1)
    const tool = session.agent.state.tools.find((tool) => tool.name === 'mcp')
    assert.ok(tool)
    const result = await tool.execute('fixture-call', { server: name, tool: 'echo', args: { value: name } }, undefined)
    const text = result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
    assert.ok(text.includes(name), text)
    assert.ok(text.includes(cwd), text)
    const wrong = await tool.execute('wrong-project', { server: name === 'project-a' ? 'project-b' : 'project-a', tool: 'echo', args: { value: 'wrong' } }, undefined)
    const wrongText = wrong.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
    assert.match(wrongText, /unknown|not found|not configured/i)
  }
  process.stdout.write('Pi MCP: isolated cwd, single adapter and real tool calls passed\n')
} finally {
  for (const session of sessions) {
    await session.abort()
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    session.dispose()
  }
  await rm(root, { recursive: true, force: true })
}
