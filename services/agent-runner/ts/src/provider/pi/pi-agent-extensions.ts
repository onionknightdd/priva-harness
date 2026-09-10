import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { createJiti } from 'jiti'

const require = createRequire(import.meta.url)
export const subagentsRoot = dirname(require.resolve('@tintinweb/pi-subagents/package.json'))
export const piCodeRoot = dirname(require.resolve('pi-code/package.json'))

export interface PiMemoryModule {
  default: ExtensionFactory
  projectSlug(cwd: string): string
  resolveMemoryDir(cwd: string, override?: string): string
  memorySettingsFiles(cwd: string, home: string, approved: boolean): string[]
  readMemorySettings(paths: string[]): { autoMemoryEnabled?: unknown; autoMemoryDirectory?: unknown }
  autoMemoryEnabled(setting: unknown, env: NodeJS.ProcessEnv): boolean
}

const transform = createJiti(import.meta.url).transform

/** CLI plugins assume one cwd and module registry per process. Give each host
 * session its own module graph and lexical cwd without ever calling process.chdir. */
function pluginLoader(cwd: string) {
  const memorySettings = fileURLToPath(import.meta.resolve('./pi-memory-settings.js'))
  return createJiti(import.meta.url, {
    moduleCache: false,
    fsCache: false,
    nativeModules: ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', '@earendil-works/pi-tui', 'typebox', '@sinclair/typebox', 'nanoid', 'croner'],
    alias: {
      '@earendil-works/pi-ai': fileURLToPath(import.meta.resolve('@earendil-works/pi-ai/compat')),
      '@earendil-works/pi-coding-agent': fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')),
      '@earendil-works/pi-tui': fileURLToPath(import.meta.resolve('@earendil-works/pi-tui')),
    },
    transform(options) {
      const filename = options.filename ?? ''
      let source = options.source
      if (filename.startsWith(subagentsRoot) || filename.startsWith(piCodeRoot)) {
        source = `const process = Object.create(globalThis.process); process.cwd = () => ${JSON.stringify(cwd)}; process.env = { ...globalThis.process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: globalThis.process.env.PI_CODE_DISABLE_AUTO_MEMORY };\n${source}`
      }
      if (filename === join(piCodeRoot, 'extensions/memory.ts')) {
        // Only substitute configuration dependencies. Storage, prompt, tools,
        // index limits and lifecycle remain the installed pi-code implementation.
        for (const name of ['config-dir', 'managed-settings', 'project-approval', 'settings-chain']) {
          source = source.replace(`'./internal/${name}.js'`, JSON.stringify(memorySettings))
        }
      }
      return { code: transform({ ...options, source }) }
    },
  })
}

export async function piSubagentFactory(cwd: string): Promise<ExtensionFactory> {
  const factory = await pluginLoader(cwd).import<ExtensionFactory>(join(subagentsRoot, 'src/index.ts'), { default: true })
  return (api) => factory({
    ...api,
    // The host already owns `workflow` through pi-dynamic-workflows. Tintin's
    // collision detector only recognizes `Workflow` (capital W), so select its
    // subagent surface explicitly rather than advertising two orchestrators.
    registerTool: (tool) => { if (tool.name !== 'SubagentWorkflow') api.registerTool(tool) },
    registerFlag: (name, options) => { if (name !== 'subagents-workflow-file') api.registerFlag(name, options) },
  })
}

export async function piMemoryModule(cwd: string): Promise<PiMemoryModule> {
  return await pluginLoader(cwd).import<PiMemoryModule>(join(piCodeRoot, 'extensions/memory.ts'))
}
