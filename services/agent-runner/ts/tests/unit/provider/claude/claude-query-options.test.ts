import { describe, expect, it } from 'vitest'

import { buildClaudeQueryOptions } from '../../../../src/provider/claude/claude-runtime.js'

describe('buildClaudeQueryOptions', () => {
  it('points the Claude SDK at the productized global config directory', () => {
    const options = buildClaudeQueryOptions(
      { cwd: '/work/repo' },
      '/home/user/.bambuddy/harness/.claude',
    )

    expect(options.cwd).toBe('/work/repo')
    expect(options.env?.['CLAUDE_CONFIG_DIR']).toBe(
      '/home/user/.bambuddy/harness/.claude',
    )
  })
})
