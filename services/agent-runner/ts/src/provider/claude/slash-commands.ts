import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { Options, Query, SDKUserMessage, SlashCommand as SdkSlashCommand } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'

import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import {
  CLAUDE_SLASH_COMMAND_WHITELIST,
  compareSlashCommands,
  intersectSlashCommands,
  isExcludedSlashName,
  type SlashCommand,
  type SlashKind,
  type SlashOrigin,
} from '../../core/resource/slash-command.js'
import { PushableStream } from '../../core/stream/pushable-stream.js'
import type { ToolDefinition } from '../../core/tool/define-tool.js'
import { resolveClaudeQueryOptions } from './claude-runtime.js'

export type ClaudeSlashQuery = Pick<
  Query,
  'supportedCommands' | 'reloadSkills' | 'initializationResult' | 'close'
> & AsyncIterable<unknown>

export type ClaudeSlashQueryStart = (args: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => ClaudeSlashQuery

export function resolveClaudeListingQueryOptions(
  spec: ProviderRunSpec,
  globalConfigDir: string,
  abortController?: AbortController,
  tools: readonly ToolDefinition[] = [],
): Options {
  return {
    ...resolveClaudeQueryOptions(
      spec,
      globalConfigDir,
      { kind: 'new', provider: 'claude' },
      abortController,
      tools,
    ),
    persistSession: false,
  }
}

export async function classifyClaudeSlashOrigin(
  name: string,
  kind: SlashKind,
  cwd: string,
  globalConfigDir: string,
): Promise<SlashOrigin> {
  if (!isSafeSlashName(name)) return 'builtin'
  if (kind === 'skill') {
    if (await skillExistsInProject(cwd, name)) return 'project'
    if (await skillExistsAt(globalConfigDir, name)) return 'user'
    return 'builtin'
  }
  if (await commandExistsInProject(cwd, name)) return 'project'
  if (await commandExistsAt(globalConfigDir, name)) return 'user'
  return 'builtin'
}

export async function assembleClaudeSlashCommands(
  commands: readonly SdkSlashCommand[],
  skills: readonly SdkSlashCommand[],
  cwd: string,
  globalConfigDir: string,
): Promise<SlashCommand[]> {
  const skillNames = new Set(skills.map((skill) => skill.name))
  const assembled = await Promise.all(
    commands.flatMap((command) => {
      if (isExcludedSlashName(command.name)) return []
      const kind: SlashKind = skillNames.has(command.name) ? 'skill' : 'command'
      return [mapSdkCommand(command, kind, cwd, globalConfigDir)]
    }),
  )
  return intersectSlashCommands(assembled.sort(compareSlashCommands), CLAUDE_SLASH_COMMAND_WHITELIST)
}

export async function listClaudeSlashCommands(options: {
  readonly spec: ProviderRunSpec
  readonly globalConfigDir: string
  readonly tools?: readonly ToolDefinition[]
  readonly startQuery?: ClaudeSlashQueryStart
}): Promise<readonly SlashCommand[]> {
  const input = new PushableStream<SDKUserMessage>()
  const abortController = new AbortController()
  const startQuery = options.startQuery ?? ((args) => query(args))
  const active = startQuery({
    prompt: input,
    options: resolveClaudeListingQueryOptions(
      options.spec,
      options.globalConfigDir,
      abortController,
      options.tools ?? [],
    ),
  })
  const drained = drainQuery(active)
  try {
    await active.initializationResult()
    const [commands, skills] = await Promise.all([
      active.supportedCommands(),
      active.reloadSkills(),
    ])
    return await assembleClaudeSlashCommands(
      commands,
      skills.skills,
      options.spec.cwd,
      options.globalConfigDir,
    )
  } finally {
    input.close()
    active.close()
    abortController.abort()
    await drained
  }
}

async function mapSdkCommand(
  command: SdkSlashCommand,
  kind: SlashKind,
  cwd: string,
  globalConfigDir: string,
): Promise<SlashCommand> {
  const origin = await classifyClaudeSlashOrigin(
    command.name,
    kind,
    cwd,
    globalConfigDir,
  )
  const argumentHint = command.argumentHint.trim()
  const aliases = command.aliases?.filter((alias) => alias.trim() !== '') ?? []
  return {
    name: command.name,
    description: command.description,
    kind,
    origin,
    ...(argumentHint === '' ? {} : { argumentHint }),
    ...(aliases.length === 0 ? {} : { aliases }),
  }
}

function isSafeSlashName(name: string): boolean {
  return name !== '' && !name.includes('/') && !name.includes('\\') && !name.includes('..')
}

async function skillExistsInProject(cwd: string, name: string): Promise<boolean> {
  for (const directory of ancestorDirectories(cwd)) {
    if (await skillExistsAt(join(directory, '.claude'), name)) return true
  }
  return false
}

async function commandExistsInProject(cwd: string, name: string): Promise<boolean> {
  for (const directory of ancestorDirectories(cwd)) {
    if (await commandExistsAt(join(directory, '.claude'), name)) return true
  }
  return false
}

async function skillExistsAt(claudeDir: string, name: string): Promise<boolean> {
  return await pathExists(join(claudeDir, 'skills', name, 'SKILL.md'))
    || await pathExists(join(claudeDir, 'skills', `${name}.md`))
}

async function commandExistsAt(claudeDir: string, name: string): Promise<boolean> {
  return pathExists(join(claudeDir, 'commands', `${name}.md`))
}

function ancestorDirectories(cwd: string): string[] {
  const directories: string[] = []
  let current = resolve(cwd)
  for (;;) {
    directories.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return directories
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function drainQuery(active: AsyncIterable<unknown>): Promise<void> {
  try {
    for await (const _message of active) {
      void _message
    }
  } catch {
    return
  }
}
