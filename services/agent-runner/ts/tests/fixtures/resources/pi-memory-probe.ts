import type * as PiLoader from '../../../src/provider/pi/pi-resource-loader.js'
import assert from 'node:assert/strict'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await realpath(await mkdtemp(join(os.tmpdir(), 'pi-memory-runtime-')))
os.homedir = () => root
syncBuiltinESMExports()
const agentDir = join(root, 'agent')
process.env['PI_CODING_AGENT_DIR'] = agentDir
process.env['CLAUDE_CONFIG_DIR'] = join(root, 'claude')
process.env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'] = '1'
delete process.env['PI_CODE_DISABLE_AUTO_MEMORY']
const { createAgentSession, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent')
const { createPiResourceLoader } = await import(pathToFileURL(resolve(process.argv[2] ?? 'src/provider/pi/pi-resource-loader.ts')).href) as typeof PiLoader
const sessions = []
try {
  for (const name of ['first', 'second']) {
    const cwd = join(root, name)
    const memoryPath = join(root, `memory-${name}`)
    await mkdir(join(cwd, '.pi'), { recursive: true })
    await mkdir(join(cwd, '.git'))
    await writeFile(join(cwd, '.pi/settings.json'), JSON.stringify({ autoMemoryEnabled: true, autoMemoryDirectory: memoryPath }))
    const settingsManager = SettingsManager.create(cwd, agentDir)
    const resourceLoader = await createPiResourceLoader(cwd, agentDir, settingsManager)
    const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(cwd) })
    sessions.push(session)
    await session.bindExtensions({ mode: 'rpc' })
    const tool = session.agent.state.tools.find((tool) => tool.name === 'memory')
    assert.ok(tool)
    const saved = await tool.execute(`save-${name}`, { action: 'save', name: 'preference', description: `Preference ${name}`, content: `Keep ${name} separate.` })
    assert.ok(saved.content.some((block) => block.type === 'text' && block.text.includes('Saved memory')))
    assert.equal(await readFile(join(memoryPath, 'preference.md'), 'utf8'), `Keep ${name} separate.`)
    assert.match(await readFile(join(memoryPath, 'MEMORY.md'), 'utf8'), new RegExp(`Preference ${name}`))
  }
  const first = sessions[0]?.agent.state.tools.find((tool) => tool.name === 'memory')
  assert.ok(first)
  const read = await first.execute('read-first', { action: 'read', name: 'preference' })
  assert.ok(read.content.some((block) => block.type === 'text' && block.text.includes('Keep first separate.')))
  process.stdout.write('Pi memory: real session binding, independent settings and isolated stores passed\n')
} finally {
  for (const session of sessions) {
    await session.abort()
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    session.dispose()
  }
  await rm(root, { recursive: true, force: true })
}
