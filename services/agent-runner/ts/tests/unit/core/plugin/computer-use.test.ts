import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveBuiltinPlugins } from '../../../../src/core/plugin/builtin-plugins.js'
import { computerMcpServers } from '../../../../src/core/plugin/computer-use.js'
import { resolveClaudeQueryOptions } from '../../../../src/provider/claude/claude-runtime.js'
import { writeNativeProductConfig } from '../../../../src/provider/claude/tools/native-product-launch.js'
import { testRunSpec } from '../../../support/run-spec.js'

const entry = fileURLToPath(new URL('../../../../src/infrastructure/computer/device-mcp.ts', import.meta.url))
const registeredCommand = {
  type: 'stdio', command: process.execPath, args: ['--import', createRequire(import.meta.url).resolve('tsx'), entry],
}

describe('session computer MCP registration', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'computer-runtime-'))
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  async function writeArchive() {
    const modules = join(root, 'lib', 'node_modules')
    const node = join(root, 'bin', 'node')
    const repl = join(root, 'bin', 'node_repl')
    const launcher = join(modules, '@oai', 'cua-repl', 'bin', 'cua-repl.mjs')
    const driver = join(modules, '@oai', 'sky', 'bin', 'linux', `sky_linux_${process.arch}`)
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ platform: process.platform, arch: process.arch }))
    for (const file of [node, repl, launcher, driver]) {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, '', { mode: 0o700 })
    }
    return { modules, node, repl, launcher, driver }
  }

  it('keeps unprovisioned sessions and incomplete device configurations free of implicit tools', () => {
    for (const env of [{}, { PRIVA_COMPUTER_HOST_KEY: 'test-key-path' }, { PRIVA_COMPUTER_DEVICES: 'test-devices-path' }]) {
      expect(computerMcpServers(['agent-dashboard'], env)).toEqual({})
      expect(resolveBuiltinPlugins(['agent-dashboard'], env).map((item) => item.id)).toEqual(['agent-dashboard'])
    }
  })

  it('registers the same device commands for explicit selection or a provisioned deployment', async () => {
    await access(entry)
    const expected = { registered_computers: { ...registeredCommand, env: { PRIVA_COMPUTER_DIR: root } } }
    expect(computerMcpServers(['computer-use'], { PRIVA_COMPUTER_DIR: root })).toEqual(expected)
    const provisioned = { PRIVA_COMPUTER_DIR: root, PRIVA_COMPUTER_HOST_KEY: 'key-path', PRIVA_COMPUTER_DEVICES: 'devices-path' }
    expect(computerMcpServers([], provisioned)).toEqual(expected)
    expect(resolveBuiltinPlugins([], provisioned).map((item) => item.id)).toEqual(['computer-use'])
  })

  it('builds stable original runtime descriptors and only forwards intended desktop settings', async () => {
    const { modules, node, repl, launcher } = await writeArchive()
    const runtimeEnv = { NODE_REPL_NODE_PATH: node, NODE_REPL_NODE_MODULE_DIRS: modules, NODE_REPL_TRUSTED_CODE_PATHS: modules }
    const servers = computerMcpServers([], {
      PRIVA_CUA_RUNTIME: root, DISPLAY: ':99', BROWSER_USE_ACCESS_EXECUTOR_ID: 'test-only',
      BROWSER_USE_ACCESS_PIPE_PATH: 'test-only', OPENAI_API_KEY: 'test-only',
    })
    expect(servers).toEqual({
      node_repl: { type: 'stdio', command: repl, args: [], env: runtimeEnv },
      cua_repl: { type: 'stdio', command: node, args: [launcher], env: {
        ...runtimeEnv, DISPLAY: ':99', CUA_REPL_NODE_REPL_PATH: repl, CUA_REPL_ENABLED_SURFACES: 'computer',
        NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ sky: '@oai/sky/service' }),
      } },
    })
  })

  it('rejects wrong platform and architecture for implicitly configured runtimes', async () => {
    expect(() => computerMcpServers([], { PRIVA_CUA_RUNTIME: 'relative' })).toThrow('absolute path')
    for (const [platform, arch] of [['unsupported', process.arch], [process.platform, 'unsupported']]) {
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ platform, arch }))
      expect(() => computerMcpServers([], { PRIVA_CUA_RUNTIME: root })).toThrow(`this Runner needs ${process.platform}/${process.arch}`)
    }
  })

  it('enables the browser provider without a Linux driver or native desktop configuration', async () => {
    const { driver } = await writeArchive()
    await rm(driver)
    const descriptor = computerMcpServers([], {
      PRIVA_CUA_RUNTIME: root, CUA_REPL_ENABLED_SURFACES: 'browser', OAI_SKY_LINUX_BIN: 'unavailable',
      DISPLAY: ':99', SKY_CUA_SERVICE_PATH: 'unused', BROWSER_USE_ACCESS_PIPE_PATH: 'unused',
    })['cua_repl']
    expect(descriptor?.env).toMatchObject({
      CUA_REPL_ENABLED_SURFACES: 'browser', NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser: '@oai/browser-desktop/service' }),
    })
    for (const key of ['DISPLAY', 'OAI_SKY_LINUX_BIN', 'SKY_CUA_SERVICE_PATH', 'BROWSER_USE_ACCESS_PIPE_PATH']) {
      expect(descriptor?.env).not.toHaveProperty(key)
    }
  })

  it('exposes Sky on the generic worker only for the selected standalone computer skill', async () => {
    await writeArchive()
    const env = {
      PRIVA_CUA_RUNTIME: root, PRIVA_CUA_SKILLS: root, PRIVA_CUA_ENABLED_SKILLS: 'browser, computer-use',
      CUA_REPL_ENABLED_SURFACES: 'browser', DISPLAY: ':99', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/test-bus',
      XAUTHORITY: '/tmp/test-display', SKY_CUA_SERVICE_PATH: 'private-host-service',
      BROWSER_USE_ACCESS_PIPE_PATH: 'private-host-pipe', OPENAI_API_KEY: 'private-host-key',
    }
    const descriptors = computerMcpServers([], env)
    expect(descriptors['node_repl']?.env).toMatchObject({
      DISPLAY: env.DISPLAY, DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS, XAUTHORITY: env.XAUTHORITY,
      NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ sky: '@oai/sky/service' }),
    })
    for (const key of ['SKY_CUA_SERVICE_PATH', 'BROWSER_USE_ACCESS_PIPE_PATH', 'OPENAI_API_KEY']) {
      expect(descriptors['node_repl']?.env).not.toHaveProperty(key)
    }
    expect(descriptors['cua_repl']?.env['NODE_REPL_TRUSTED_SERVICES']).toBe(JSON.stringify({ browser: '@oai/browser-desktop/service' }))
    for (const overrides of [
      { PRIVA_CUA_ENABLED_SKILLS: 'browser,record-and-replay' },
      { CUA_REPL_ENABLED_SURFACES: 'browser,computer' },
      { PRIVA_CUA_SKILLS: '' },
    ]) {
      const plain = computerMcpServers([], { ...env, ...overrides })['node_repl']?.env
      expect(plain).not.toHaveProperty('NODE_REPL_TRUSTED_SERVICES')
      expect(plain).not.toHaveProperty('DISPLAY')
    }
  })

  it.each(['browser', 'chrome'])('registers only the packaged browser service for the standalone %s skill', async (id) => {
    await writeArchive()
    const env = { PRIVA_CUA_RUNTIME: root, PRIVA_CUA_SKILLS: root, PRIVA_CUA_ENABLED_SKILLS: id,
      DISPLAY: ':99', BROWSER_USE_ACCESS_EXECUTOR_ID: 'private-host-id', BROWSER_USE_ACCESS_PIPE_PATH: 'private-host-pipe' }
    const descriptors = computerMcpServers([], env)
    expect(descriptors['node_repl']?.env['NODE_REPL_TRUSTED_SERVICES']).toBe(JSON.stringify({ browser: '@oai/browser-desktop/service' }))
    for (const key of ['DISPLAY', 'BROWSER_USE_ACCESS_EXECUTOR_ID', 'BROWSER_USE_ACCESS_PIPE_PATH']) {
      expect(descriptors['node_repl']?.env).not.toHaveProperty(key)
    }
    expect(descriptors['cua_repl']?.env['NODE_REPL_TRUSTED_SERVICES']).toBe(JSON.stringify({ sky: '@oai/sky/service' }))
  })

  it('can enable both providers and rejects invalid surface declarations', async () => {
    await writeArchive()
    const env = { PRIVA_CUA_RUNTIME: root, CUA_REPL_ENABLED_SURFACES: 'browser,computer', DISPLAY: ':99' }
    const descriptor = computerMcpServers([], env)['cua_repl']
    expect(descriptor?.env).toMatchObject({ CUA_REPL_ENABLED_SURFACES: 'browser,computer', DISPLAY: ':99' })
    expect(JSON.parse(descriptor?.env['NODE_REPL_TRUSTED_SERVICES'] ?? 'null')).toEqual({
      browser: '@oai/browser-desktop/service', sky: '@oai/sky/service',
    })
    for (const value of ['', 'all', 'browser,browser']) {
      expect(() => computerMcpServers([], { ...env, CUA_REPL_ENABLED_SURFACES: value })).toThrow('CUA_REPL_ENABLED_SURFACES')
    }
  })

  it('requires the actual worker executable and its JavaScript launcher', async () => {
    const { launcher, repl } = await writeArchive()
    await rm(launcher)
    expect(() => computerMcpServers([], { PRIVA_CUA_RUNTIME: root })).toThrow('cua-repl.mjs')
    await rm(repl)
    expect(() => computerMcpServers([], { PRIVA_CUA_RUNTIME: root })).toThrow('node_repl')
  })

  it.runIf(process.platform === 'linux')('requires a packaged or explicitly provisioned Linux desktop driver', async () => {
    const { driver } = await writeArchive()
    await rm(driver)
    const env = { PRIVA_CUA_RUNTIME: root }
    expect(() => computerMcpServers([], env)).toThrow('sky_linux_')
    const standalone = { ...env, PRIVA_CUA_SKILLS: root, PRIVA_CUA_ENABLED_SKILLS: 'computer-use', CUA_REPL_ENABLED_SURFACES: 'browser' }
    expect(() => computerMcpServers([], standalone)).toThrow('sky_linux_')
    expect(() => computerMcpServers([], { ...env, OAI_SKY_LINUX_BIN: 'relative' })).toThrow('must be an absolute path')
    const installed = join(root, 'sky-linux-driver')
    await writeFile(installed, '', { mode: 0o700 })
    expect(computerMcpServers([], { ...env, OAI_SKY_LINUX_BIN: installed })['cua_repl']?.env['OAI_SKY_LINUX_BIN']).toBe(installed)
  })

  it('registers the same implicit device server in Claude SDK sessions and native CLI sessions', async () => {
    vi.stubEnv('PRIVA_CUA_RUNTIME', undefined)
    vi.stubEnv('PRIVA_CUA_ENABLED_SKILLS', undefined)
    vi.stubEnv('PRIVA_COMPUTER_HOST_KEY', 'key-path')
    vi.stubEnv('PRIVA_COMPUTER_DEVICES', 'devices-path')
    vi.stubEnv('PRIVA_COMPUTER_DIR', root)
    const spec = testRunSpec({ cwd: root })
    const expected = { registered_computers: { ...registeredCommand, env: { PRIVA_COMPUTER_DIR: root } } }
    expect(resolveClaudeQueryOptions(spec).mcpServers).toEqual(expected)
    const file = join(root, 'product-mcp.json')
    expect(await writeNativeProductConfig(root, { kind: 'new', provider: 'claude' }, spec, [])).toEqual(['--mcp-config', file])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ mcpServers: expected })
  })
})
