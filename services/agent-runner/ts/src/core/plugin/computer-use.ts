import { accessSync, constants, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

interface ComputerServer {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

const archive = z.object({ platform: z.string(), arch: z.string() })

export function runtimeSurfaces(env: NodeJS.ProcessEnv): 'computer' | 'browser' | 'browser,computer' {
  const value = env['CUA_REPL_ENABLED_SURFACES'] ?? 'computer'
  if (value !== 'computer' && value !== 'browser' && value !== 'browser,computer') {
    throw new Error('CUA_REPL_ENABLED_SURFACES must be computer, browser, or browser,computer')
  }
  return value
}

/** Only publish standalone skills for surfaces the unified worker does not already own. */
export function standaloneComputerSkillIds(env: NodeJS.ProcessEnv): string[] {
  const selected = (env['PRIVA_CUA_ENABLED_SKILLS'] ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  const surfaces = env['PRIVA_CUA_RUNTIME'] ? runtimeSurfaces(env) : ''
  return selected.filter((id) => {
    if (id === 'computer-use') return !surfaces.includes('computer')
    if (id === 'browser' || id === 'chrome') return !surfaces.includes('browser')
    return true
  })
}

function workerSurfaceEnv(computer: boolean, browser: boolean, env: NodeJS.ProcessEnv): Record<string, string> {
  const desktop: Record<string, string> = {}
  const services: Record<string, string> = {}
  if (computer) {
    services['sky'] = '@oai/sky/service'
    for (const name of ['DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'OAI_SKY_LINUX_BIN']) {
      if (env[name]) desktop[name] = env[name]
    }
  }
  if (browser) services['browser'] = '@oai/browser-desktop/service'
  return computer || browser ? { ...desktop, NODE_REPL_TRUSTED_SERVICES: JSON.stringify(services) } : {}
}

export function computerUseEnabled(ids: readonly string[], env: NodeJS.ProcessEnv = process.env): boolean {
  return ids.includes('computer-use') || Boolean(env['PRIVA_CUA_RUNTIME'])
    || Boolean(env['PRIVA_COMPUTER_HOST_KEY'] && env['PRIVA_COMPUTER_DEVICES'])
}

/** Build descriptors for the selected session without modifying either provider's global configuration. */
export function computerMcpServers(
  enabledIds: readonly string[], env: NodeJS.ProcessEnv = process.env,
): Record<string, ComputerServer> {
  if (!computerUseEnabled(enabledIds, env)) return {}
  const source = import.meta.url.endsWith('.ts')
  const entry = fileURLToPath(new URL(`../../infrastructure/computer/device-mcp.${source ? 'ts' : 'js'}`, import.meta.url))
  const servers: Record<string, ComputerServer> = {}
  if (enabledIds.includes('computer-use') || Boolean(env['PRIVA_COMPUTER_DIR'])
    || Boolean(env['PRIVA_COMPUTER_HOST_KEY'] && env['PRIVA_COMPUTER_DEVICES'])) {
    servers['registered_computers'] = {
      type: 'stdio', command: process.execPath,
      args: [...(source ? ['--import', createRequire(import.meta.url).resolve('tsx')] : []), entry],
      env: env['PRIVA_COMPUTER_DIR'] ? { PRIVA_COMPUTER_DIR: env['PRIVA_COMPUTER_DIR'] } : {},
    }
  }
  const root = env['PRIVA_CUA_RUNTIME']
  if (!root) return servers
  if (!isAbsolute(root)) throw new Error('PRIVA_CUA_RUNTIME must be the absolute path of the installed cua_node runtime')
  const metadata = archive.parse(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')))
  if (metadata.platform !== process.platform || metadata.arch !== process.arch) {
    throw new Error(`Computer Use runtime targets ${metadata.platform}/${metadata.arch}; this Runner needs ${process.platform}/${process.arch}`)
  }

  const node = join(root, 'bin', 'node')
  const repl = join(root, 'bin', 'node_repl')
  const modules = join(root, 'lib', 'node_modules')
  const launcher = join(modules, '@oai', 'cua-repl', 'bin', 'cua-repl.mjs')
  for (const executable of [node, repl]) accessSync(executable, constants.X_OK)
  accessSync(launcher, constants.R_OK)
  const surfaces = runtimeSurfaces(env)
  const hasComputer = surfaces.includes('computer')
  const hasBrowser = surfaces.includes('browser')
  const standalone = env['PRIVA_CUA_SKILLS'] ? standaloneComputerSkillIds(env) : []
  const standaloneComputer = standalone.includes('computer-use')
  const standaloneBrowser = standalone.includes('browser') || standalone.includes('chrome')
  if ((hasComputer || standaloneComputer) && process.platform === 'linux') {
    const driver = env['OAI_SKY_LINUX_BIN'] ?? join(modules, '@oai', 'sky', 'bin', 'linux', `sky_linux_${process.arch}`)
    if (!isAbsolute(driver)) throw new Error('OAI_SKY_LINUX_BIN must be an absolute path')
    accessSync(driver, constants.X_OK)
  }
  const runtimeEnv = {
    NODE_REPL_NODE_PATH: node, NODE_REPL_NODE_MODULE_DIRS: modules, NODE_REPL_TRUSTED_CODE_PATHS: modules,
  }
  servers['node_repl'] = {
    type: 'stdio', command: repl, args: [],
    env: { ...runtimeEnv, ...workerSurfaceEnv(standaloneComputer, standaloneBrowser, env) },
  }
  servers['cua_repl'] = {
    type: 'stdio', command: node, args: [launcher],
    env: {
      ...runtimeEnv, ...workerSurfaceEnv(hasComputer, hasBrowser, env),
      ...(hasComputer && env['SKY_CUA_SERVICE_PATH'] ? { SKY_CUA_SERVICE_PATH: env['SKY_CUA_SERVICE_PATH'] } : {}),
      CUA_REPL_NODE_REPL_PATH: repl, CUA_REPL_ENABLED_SURFACES: surfaces,
    },
  }
  return servers
}
