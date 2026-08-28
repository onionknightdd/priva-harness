import { describe, expect, it } from 'vitest'

import {
  CLAUDE_SLASH_COMMAND_WHITELIST,
  intersectSlashCommands,
  mergeSlashCommands,
  PI_SLASH_COMMAND_WHITELIST,
  type SlashCommand,
} from '../../../../src/core/resource/slash-command.js'

describe('slash command catalog helpers', () => {
  it('keeps the highest-origin entry for a duplicated name', () => {
    const commands: SlashCommand[] = [
      { name: 'compact', description: 'builtin', kind: 'command', origin: 'builtin' },
      { name: 'compact', description: 'user', kind: 'command', origin: 'user' },
      { name: 'compact', description: 'project', kind: 'command', origin: 'project' },
      { name: 'review', description: 'skill', kind: 'skill', origin: 'user' },
    ]
    expect(mergeSlashCommands(commands)).toEqual([
      { name: 'compact', description: 'project', kind: 'command', origin: 'project' },
      { name: 'review', description: 'skill', kind: 'skill', origin: 'user' },
    ])
  })

  it('keeps only runtime entries whose names are in the whitelist', () => {
    const compact: SlashCommand = {
      name: 'compact',
      description: 'Compact context',
      argumentHint: '[focus]',
      aliases: ['summarize'],
      kind: 'command',
      origin: 'project',
    }
    const session: SlashCommand = {
      name: 'session',
      description: 'Session info',
      kind: 'command',
      origin: 'builtin',
    }
    const extra: SlashCommand = {
      name: 'model',
      description: 'Not allowed',
      aliases: ['compact'],
      kind: 'command',
      origin: 'builtin',
    }

    expect(intersectSlashCommands([extra, compact, session], PI_SLASH_COMMAND_WHITELIST)).toEqual([
      compact,
      session,
    ])
    expect(intersectSlashCommands([compact], CLAUDE_SLASH_COMMAND_WHITELIST)).toEqual([compact])
    expect(
      intersectSlashCommands(
        [extra],
        ['ghost', ...CLAUDE_SLASH_COMMAND_WHITELIST],
      ),
    ).toEqual([])
    expect(
      intersectSlashCommands(
        [{ ...compact, name: '/Compact' }],
        CLAUDE_SLASH_COMMAND_WHITELIST,
      ),
    ).toEqual([{ ...compact, name: '/Compact' }])
    expect(
      intersectSlashCommands(
        [{
          name: 'plugin:code-review',
          description: 'Review a change',
          kind: 'skill',
          origin: 'builtin',
        }],
        CLAUDE_SLASH_COMMAND_WHITELIST,
      ),
    ).toEqual([
      {
        name: 'plugin:code-review',
        description: 'Review a change',
        kind: 'skill',
        origin: 'builtin',
      },
    ])
  })
})
