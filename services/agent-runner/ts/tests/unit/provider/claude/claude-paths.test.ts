import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { claudeGlobalDir, claudeProjectDir } from '../../../../src/provider/claude/claude-paths.js'

describe('claude paths', () => {
  it('places global config under harness/.claude and project config under cwd/.claude', () => {
    expect(claudeGlobalDir('/home/user/.bambuddy/harness')).toBe(
      join('/home/user/.bambuddy/harness', '.claude'),
    )
    expect(claudeProjectDir('/work/repo')).toBe(join('/work/repo', '.claude'))
  })
})
