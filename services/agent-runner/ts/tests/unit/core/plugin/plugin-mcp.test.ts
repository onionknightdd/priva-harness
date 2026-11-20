import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuiltinPlugin, PluginMcpDeclaration } from '../../../../src/core/plugin/builtin-plugins.js'
import { resolvePluginMcpServers } from '../../../../src/core/plugin/plugin-mcp.js'

const target = `${process.platform}-${process.arch}`

describe('plugin MCP servers', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'plugin-mcp-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  function plugin(id: string, mcpServers: Record<string, Partial<PluginMcpDeclaration> & { command: string }>): BuiltinPlugin {
    return {
      id, name: id, description: id, icon: 'test', rootDir: join(root, id), skillDirs: [],
      mcpServers: Object.fromEntries(Object.entries(mcpServers).map(([name, declaration]) => [
        name, { args: [], env: {}, inheritEnv: [], hiddenTools: [], ...declaration },
      ])),
    }
  }

  async function installRuntime(id: string, declared = target): Promise<string> {
    const runtime = join(root, id, 'mcp', 'runtime', target)
    await mkdir(runtime, { recursive: true })
    await writeFile(join(runtime, 'manifest.json'), JSON.stringify({ target: declared }))
    return runtime
  }

  it('points every placeholder at the runtime shipped for this platform', async () => {
    const runtime = await installRuntime('desktop')
    const servers = resolvePluginMcpServers([plugin('desktop', { worker: {
      command: '${runtime}/bin/node', args: ['${plugin}/mcp/launch.mjs', '${runtime}', '--flag'],
      env: { WORKER: '${runtime}/bin/worker', MODE: 'computer' },
    } })], {})
    expect(servers).toEqual([{
      name: 'worker', command: join(runtime, 'bin/node'), args: [join(root, 'desktop', 'mcp/launch.mjs'), runtime, '--flag'],
      env: { WORKER: join(runtime, 'bin/worker'), MODE: 'computer' }, hiddenTools: [],
    }])
  })

  it('forwards only the listed Runner variables that are set, and lets the declaration win', async () => {
    await installRuntime('desktop')
    const [server] = resolvePluginMcpServers([plugin('desktop', { worker: {
      command: '${runtime}/bin/node', env: { MODE: 'declared' }, inheritEnv: ['DISPLAY', 'XAUTHORITY', 'MODE'],
    } })], { DISPLAY: ':99', XAUTHORITY: '', MODE: 'inherited', SECRET_TOKEN: 'never-forwarded' })
    expect(server?.env).toEqual({ DISPLAY: ':99', MODE: 'declared' })
  })

  it('always hides the turn-end tool together with the declared host-only tools', async () => {
    await installRuntime('desktop')
    const [first, second] = resolvePluginMcpServers([plugin('desktop', {
      first: { command: 'node', hiddenTools: ['debug', 'turn_ended'], turnEndTool: 'turn_ended' },
      second: { command: 'node', hiddenTools: ['debug'] },
    })], {})
    expect(first).toMatchObject({ hiddenTools: ['debug', 'turn_ended'], turnEndTool: 'turn_ended' })
    expect(second?.hiddenTools).toEqual(['debug'])
    expect(second).not.toHaveProperty('turnEndTool')
  })

  it('names the directory to fill when the runtime for this platform is missing or mismatched', async () => {
    const declaration = { worker: { command: '${runtime}/bin/node' } }
    const expected = join(root, 'desktop', 'mcp', 'runtime', target)
    expect(() => resolvePluginMcpServers([plugin('desktop', declaration)], {})).toThrow(`has no ${target} runtime. Install one at ${expected}`)
    await installRuntime('desktop', 'other-arch')
    expect(() => resolvePluginMcpServers([plugin('desktop', declaration)], {})).toThrow(`targets other-arch; this Runner needs ${target}`)
  })

  it('starts a Runner module on the Runner\'s own Node, without needing a plugin runtime', () => {
    const [server] = resolvePluginMcpServers([{ ...plugin('desktop', {}), mcpServers: { devices: {
      runnerModule: 'infrastructure/computer/device-mcp', args: ['--flag'], env: {}, inheritEnv: ['PRIVA_COMPUTER_DIR'], hiddenTools: [], turnEndTool: 'turn_ended',
    } } }], { PRIVA_COMPUTER_DIR: '/run/devices' })
    expect(server).toEqual({
      name: 'devices', command: process.execPath,
      args: ['--import', createRequire(import.meta.url).resolve('tsx'),
        fileURLToPath(new URL('../../../../src/infrastructure/computer/device-mcp.ts', import.meta.url)), '--flag'],
      env: { PRIVA_COMPUTER_DIR: '/run/devices' }, hiddenTools: ['turn_ended'], turnEndTool: 'turn_ended',
    })
  })

  it('starts servers that need no runtime, and rejects unknown placeholders and name collisions', () => {
    expect(resolvePluginMcpServers([plugin('plain', { tool: { command: 'node', args: ['server.js'] } })], {}))
      .toEqual([{ name: 'tool', command: 'node', args: ['server.js'], env: {}, hiddenTools: [] }])
    expect(() => resolvePluginMcpServers([plugin('plain', { tool: { command: '${home}/bin/node' } })], {})).toThrow('unknown placeholder: ${home}')
    const duplicate = { shared: { command: 'node' } }
    expect(() => resolvePluginMcpServers([plugin('one', duplicate), plugin('two', duplicate)], {})).toThrow('declared by more than one plugin')
  })
})
