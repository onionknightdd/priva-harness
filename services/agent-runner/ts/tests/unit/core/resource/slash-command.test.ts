import { describe, expect, it } from 'vitest'

import {
  isExcludedSlashName,
  mergeSlashCommands,
  type SlashCommand,
} from '../../../../src/core/resource/slash-command.js'

describe('slash command catalog helpers', () => {
  it('excludes MCP prompts and plugin-qualified names', () => {
    expect(isExcludedSlashName('compact')).toBe(false)
    expect(isExcludedSlashName('mcp__linear__create_issue')).toBe(true)
    expect(isExcludedSlashName('plugin:code-review')).toBe(true)
  })

  it('keeps the highest-origin entry for a duplicated name', () => {
    const commands: SlashCommand[] = [
      { name: 'compact', description: 'builtin', kind: 'command', origin: 'builtin' },
      { name: 'compact', description: 'user', kind: 'command', origin: 'user' },
      { name: 'compact', description: 'project', kind: 'command', origin: 'project' },
      { name: 'mcp__skip', description: 'mcp', kind: 'command', origin: 'project' },
      { name: 'review', description: 'skill', kind: 'skill', origin: 'user' },
    ]
    expect(mergeSlashCommands(commands)).toEqual([
      { name: 'compact', description: 'project', kind: 'command', origin: 'project' },
      { name: 'review', description: 'skill', kind: 'skill', origin: 'user' },
    ])
  })
})
