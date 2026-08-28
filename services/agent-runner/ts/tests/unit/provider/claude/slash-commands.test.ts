import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Query, SDKMessage, SDKUserMessage, SlashCommand as SdkSlashCommand } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { CLAUDE_DISABLED_SKILLS } from '../../../../src/provider/claude/claude-runtime.js'
import {
  assembleClaudeSlashCommands,
  classifyClaudeSlashOrigin,
  listClaudeSlashCommands,
  resolveClaudeListingQueryOptions,
  type ClaudeSlashQuery,
} from '../../../../src/provider/claude/slash-commands.js'
import { testRunSpec } from '../../../support/run-spec.js'

describe('Claude slash command catalog', () => {
  it('classifies origin from project, then user, then builtin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-slash-origin-'))
    const project = join(root, 'repo')
    const nested = join(project, 'src')
    const globalConfigDir = join(root, 'global', '.claude')
    await mkdir(join(project, '.claude', 'commands'), { recursive: true })
    await mkdir(join(project, '.claude', 'skills', 'review'), { recursive: true })
    await mkdir(join(globalConfigDir, 'commands'), { recursive: true })
    await mkdir(join(globalConfigDir, 'skills', 'notes'), { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(join(project, '.claude', 'commands', 'deploy.md'), '# deploy\n')
    await writeFile(join(project, '.claude', 'skills', 'review', 'SKILL.md'), '# review\n')
    await writeFile(join(globalConfigDir, 'commands', 'compact.md'), '# compact\n')
    await writeFile(join(globalConfigDir, 'skills', 'notes', 'SKILL.md'), '# notes\n')

    expect(await classifyClaudeSlashOrigin('deploy', 'command', nested, globalConfigDir)).toBe('project')
    expect(await classifyClaudeSlashOrigin('review', 'skill', nested, globalConfigDir)).toBe('project')
    expect(await classifyClaudeSlashOrigin('compact', 'command', nested, globalConfigDir)).toBe('user')
    expect(await classifyClaudeSlashOrigin('notes', 'skill', nested, globalConfigDir)).toBe('user')
    expect(await classifyClaudeSlashOrigin('clear', 'command', nested, globalConfigDir)).toBe('builtin')
    expect(await classifyClaudeSlashOrigin('code-review', 'skill', nested, globalConfigDir)).toBe('builtin')
  })

  it('marks reloadSkills names as skills and drops MCP or plugin entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-slash-assemble-'))
    const cwd = join(root, 'repo')
    const globalConfigDir = join(root, '.claude')
    await mkdir(join(cwd, '.claude', 'skills', 'review'), { recursive: true })
    await writeFile(join(cwd, '.claude', 'skills', 'review', 'SKILL.md'), '# review\n')

    const commands: SdkSlashCommand[] = [
      { name: 'compact', description: 'Compact context', argumentHint: '' },
      { name: 'review', description: 'Review a change', argumentHint: '<file>', aliases: ['pr'] },
      { name: 'mcp__linear__create_issue', description: 'MCP', argumentHint: '' },
      { name: 'plugin:dataviz', description: 'Plugin', argumentHint: '' },
    ]
    const skills: SdkSlashCommand[] = [
      { name: 'review', description: 'Review a change', argumentHint: '<file>' },
    ]

    expect(await assembleClaudeSlashCommands(commands, skills, cwd, globalConfigDir)).toEqual([
      {
        name: 'compact',
        description: 'Compact context',
        kind: 'command',
        origin: 'builtin',
      },
      {
        name: 'review',
        description: 'Review a change',
        argumentHint: '<file>',
        aliases: ['pr'],
        kind: 'skill',
        origin: 'project',
      },
    ])
  })

  it('lists from a short-lived query using runtime skill overrides and persistSession false', async () => {
    const spec = testRunSpec({ cwd: '/work/repo' })
    const options = resolveClaudeListingQueryOptions(spec, '/cfg/.claude')
    expect(options.persistSession).toBe(false)
    expect(options.settings).toEqual({
      crossSessionInbound: 'accept',
      skillOverrides: Object.fromEntries(CLAUDE_DISABLED_SKILLS.map((name) => [name, 'off'])),
    })

    const listed = await listClaudeSlashCommands({
      spec,
      globalConfigDir: '/cfg/.claude',
      startQuery: ({ prompt }) => new FakeClaudeSlashQuery(prompt, [
        { name: 'compact', description: 'Compact context', argumentHint: '' },
      ], []),
    })
    expect(listed).toEqual([
      {
        name: 'compact',
        description: 'Compact context',
        kind: 'command',
        origin: 'builtin',
      },
    ])
  })
})

class FakeClaudeSlashQuery implements ClaudeSlashQuery {
  constructor(
    private readonly prompt: AsyncIterable<SDKUserMessage>,
    private readonly commands: SdkSlashCommand[],
    private readonly skills: SdkSlashCommand[],
  ) {}

  supportedCommands(): Promise<SdkSlashCommand[]> {
    return Promise.resolve(this.commands)
  }

  reloadSkills(): Promise<{ skills: SdkSlashCommand[] }> {
    return Promise.resolve({ skills: this.skills })
  }

  initializationResult(): ReturnType<Query['initializationResult']> {
    return Promise.resolve({} as Awaited<ReturnType<Query['initializationResult']>>)
  }

  close(): void {
    return undefined
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.prompt[Symbol.asyncIterator]() as AsyncIterator<SDKMessage>
  }
}
