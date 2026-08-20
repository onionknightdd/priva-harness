import { describe, expect, it } from 'vitest'

import { resolveClaudeQueryOptions } from '../../../../src/provider/claude/claude-runtime.js'

describe('resolveClaudeQueryOptions', () => {
  it('resolves run spec fields onto Claude SDK options', () => {
    const options = resolveClaudeQueryOptions(
      {
        cwd: '/work/repo',
        provider: 'claude',
        model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com/anthropic',
        authToken: 'secret',
      },
      '/home/user/.bambuddy/harness/.claude',
    )

    expect(options.cwd).toBe('/work/repo')
    expect(options.model).toBe('deepseek-v4-flash')
    expect(options.includePartialMessages).toBe(true)
    expect(options.permissionMode).toBe('bypassPermissions')
    expect(options.allowDangerouslySkipPermissions).toBe(true)
    expect(options.env?.['CLAUDE_CONFIG_DIR']).toBe(
      '/home/user/.bambuddy/harness/.claude',
    )
    expect(options.env?.['ANTHROPIC_BASE_URL']).toBe(
      'https://api.deepseek.com/anthropic',
    )
    expect(options.env?.['ANTHROPIC_API_KEY']).toBe('secret')
    expect(options.env?.['ANTHROPIC_AUTH_TOKEN']).toBe('secret')
    expect(options.env?.['ANTHROPIC_MODEL']).toBeUndefined()
  })
})
