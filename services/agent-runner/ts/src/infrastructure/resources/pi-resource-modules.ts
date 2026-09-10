import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const require = createRequire(import.meta.url)
export const subagentsRoot = dirname(require.resolve('@tintinweb/pi-subagents/package.json'))
const piCodeRoot = dirname(require.resolve('pi-code/package.json'))
const loader = createJiti(import.meta.url, {
  alias: { '@earendil-works/pi-ai': fileURLToPath(import.meta.resolve('@earendil-works/pi-ai/compat')) },
})
interface DefaultAgent { name: string; description: string; model?: string; systemPrompt: string; builtinToolNames?: string[]; promptMode: string }
interface MemoryModule {
  projectSlug(cwd: string): string
  resolveMemoryDir(cwd: string, override?: string): string
  autoMemoryEnabled(setting: unknown, env: NodeJS.ProcessEnv): boolean
}
let defaults: Promise<{ DEFAULT_AGENTS: Map<string, DefaultAgent> }> | undefined
let memory: Promise<MemoryModule> | undefined
let roots: Promise<{ repoRoot(cwd: string): string | undefined }> | undefined
let agents: Promise<{ parseAgentFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } }> | undefined
let agentMemory: Promise<{ resolveMemoryDir(name: string, scope: 'user' | 'project' | 'local', cwd: string): string }> | undefined

// Import pure discovery helpers only; extension factories are never executed by listings.
export async function piDefaultAgents(): Promise<Map<string, DefaultAgent>> {
  defaults ??= loader.import(join(subagentsRoot, 'src/default-agents.ts'))
  return (await defaults).DEFAULT_AGENTS
}
export async function piMemoryModule(): Promise<MemoryModule> {
  memory ??= loader.import(join(piCodeRoot, 'extensions/memory.ts'))
  return await memory
}
export async function memoryProjectRoot(cwd: string): Promise<string> {
  roots ??= loader.import(join(piCodeRoot, 'extensions/internal/project-root.ts'))
  return (await roots).repoRoot(cwd) ?? cwd
}
export async function parsePiAgent(content: string) {
  agents ??= loader.import(join(subagentsRoot, 'src/custom-agents.ts'))
  const parsed = (await agents).parseAgentFrontmatter(content)
  return { definition: parsed.frontmatter, prompt: parsed.body.trim() }
}
export async function piAgentMemoryDirectory(name: string, scope: 'user' | 'project' | 'local', cwd: string): Promise<string> {
  agentMemory ??= loader.import(join(subagentsRoot, 'src/memory.ts'))
  return (await agentMemory).resolveMemoryDir(name, scope, cwd)
}
