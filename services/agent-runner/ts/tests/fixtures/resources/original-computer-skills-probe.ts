import type * as PiLoader from '../../../src/provider/pi/pi-resource-loader.js'
import type * as ClaudeRuntime from '../../../src/provider/claude/claude-runtime.js'
import type * as ClaudeLaunch from '../../../src/provider/claude/terminal/claude-terminal-launch.js'
import type * as ClaudeExe from '../../../src/provider/claude/claude-executable.js'
import type { ProviderRunSpec } from '../../../src/core/contract/agent-provider.js'
import type * as OriginalSkills from '../../../src/core/plugin/original-computer-skills.js'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [staged, compiled = 'dist', profile = 'mac', ...extra] = process.argv.slice(2)
if (!staged || extra.length || !['linux', 'mac'].includes(profile)) {
  throw new Error('Usage: original-computer-skills-probe.ts STAGED_ROOT [COMPILED_DIR] [mac|linux]')
}
const output = resolve(compiled)
const root = await mkdtemp(join(tmpdir(), 'original-skills-discovery-'))
const cwd = join(root, 'work')
const pi = join(root, 'pi')
const claude = join(root, 'claude')
const modulePath = (path: string) => pathToFileURL(join(output, path)).href
try {
  const { originalComputerSkills, originalPluginIds } = await import(modulePath('core/plugin/original-computer-skills.js')) as typeof OriginalSkills
  const ids = profile === 'linux' ? ['browser', 'chrome', 'computer-use'] as const : originalPluginIds
  const expectedSkills = ids.map((id) => originalComputerSkills[id])
  await Promise.all([cwd, pi, claude].map((path) => mkdir(path, { mode: 0o700 })))
  Object.assign(process.env, {
    HOME: root, PI_CODING_AGENT_DIR: pi, CLAUDE_CONFIG_DIR: claude,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', PRIVA_CUA_SKILLS: resolve(staged),
    PRIVA_CUA_ENABLED_SKILLS: ids.join(','),
  })
  delete process.env['PRIVA_CUA_RUNTIME']
  delete process.env['PRIVA_COMPUTER_HOST_KEY']
  delete process.env['PRIVA_COMPUTER_DEVICES']
  const { SettingsManager, SessionManager, createAgentSession } = await import('@earendil-works/pi-coding-agent')
  const { createPiResourceLoader } = await import(modulePath('provider/pi/pi-resource-loader.js')) as typeof PiLoader
  const settings = SettingsManager.create(cwd, pi)
  const verifyDevices = Boolean(process.env['PRIVA_COMPUTER_DIR'])
  const loader = await createPiResourceLoader(cwd, pi, settings, undefined, [], [], verifyDevices ? ['computer-use'] : [])
  const names = loader.getSkills().skills.map((s) => s.name)
  for (const expected of expectedSkills) {
    assert.equal(names.filter((name) => name === expected).length, 1, `Expected one Pi skill named ${expected}`)
  }
  console.log('Pi original skill discovery:', expectedSkills.join(', '))

  if (verifyDevices) {
    const { session } = await createAgentSession({ cwd, agentDir: pi, settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) })
    try {
      await session.bindExtensions({ mode: 'rpc' })
      const name = 'mcp__registered_computers__list_devices'
      const deadline = Date.now() + 10_000
      while (!session.getAllTools().some((tool) => tool.name === name) && Date.now() < deadline) await delay(25)
      assert(session.getAllTools().some((tool) => tool.name === name), name)
      const tool = session.agent.state.tools.find((entry) => entry.name === 'codemode')
      assert(tool)
      const id = 'original-skills-device-list'
      const code = `const response = await tools.${name}({});
        if (response.isError) throw new Error(response.content[0].text);
        const devices = JSON.parse(response.content[0].text);
        if (!Array.isArray(devices)) throw new Error("Expected a device list");
        text(devices);`
      // Codemode requires an issuing assistant message even for an offline probe.
      session.agent.state.messages = [...session.agent.state.messages, {
        role: 'assistant', content: [{ type: 'toolCall', id, name: 'codemode', arguments: { code } }],
        api: 'openai-responses', provider: 'fixture', model: 'fixture', stopReason: 'toolUse', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }]
      const result = await tool.execute(id, { code })
      const text = result.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
      assert(text.includes('Script completed'), text)
      console.log('Pi real MCP list_devices:', text)
    } finally {
      try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }) } finally { session.dispose() }
    }
  }
  const { resolveClaudeQueryOptions } = await import(modulePath('provider/claude/claude-runtime.js')) as typeof ClaudeRuntime
  const { claudeTerminalLaunch } = await import(modulePath('provider/claude/terminal/claude-terminal-launch.js')) as typeof ClaudeLaunch
  const { resolveBundledClaudeExecutable } = await import(modulePath('provider/claude/claude-executable.js')) as typeof ClaudeExe
  const executable = resolveBundledClaudeExecutable()
  assert(executable, 'Bundled Claude CLI is required for native resource discovery')
  const spec: ProviderRunSpec = { cwd, provider: 'claude', runMode: 'code', systemInstructions: 'Offline resource discovery fixture.', model: 'fixture', baseUrl: 'http://127.0.0.1:1', authToken: 'offline-fixture' }
  const options = resolveClaudeQueryOptions(spec)
  const launch = await claudeTerminalLaunch({ target: { kind: 'new', provider: 'claude', sessionId: randomUUID() }, spec, context: { scratchDir: claude, cols: 80, rows: 25 }, executable })
  const cliDirs = launch.args.flatMap((v, i, a) => v === '--plugin-dir' ? [a[i + 1]] : [])
  assert.deepEqual(cliDirs, (options.plugins ?? []).map((p) => p.path))
  assert.deepEqual(cliDirs, ids.map((id) => join(resolve(staged), id)))
  console.log(`Claude native terminal and SDK selected the same ${ids.length} original plugin directories`)

  // Open only the SDK control channel. An empty input stream submits no model prompts.
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  let finish = () => { /* Set while creating the pending input promise. */ }
  const hold = new Promise<void>((r) => { finish = r })
  const sdk = query({
    prompt: (async function* () { await hold; yield* [] })(),
    options: { ...options, env: { ...process.env, ...options.env }, pathToClaudeCodeExecutable: executable, settingSources: [], persistSession: false },
  })
  const deadline = setTimeout(() => sdk.close(), 25_000)
  try {
    const commands = (await sdk.supportedCommands()).map((c) => c.name).filter((n) => n.includes('priva-original'))
    const expected = ids.map((id) => `priva-original-${id}:${originalComputerSkills[id]}`)
    assert.deepEqual(commands.sort(), expected.sort())
    console.log('Claude SDK command discovery:', commands.join(', '))
  } finally { clearTimeout(deadline); finish(); sdk.close() }
} finally { await rm(root, { recursive: true, force: true }) }
