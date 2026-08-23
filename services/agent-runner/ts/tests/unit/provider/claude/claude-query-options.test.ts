import { describe, expect, it } from 'vitest'

import {
  CLAUDE_DISALLOWED_TOOLS,
  resolveClaudeQueryOptions,
} from '../../../../src/provider/claude/claude-runtime.js'

const spec = {
  cwd: '/work/repo',
  provider: 'claude' as const,
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/anthropic',
  authToken: 'secret',
}

describe('resolveClaudeQueryOptions', () => {
  it('resolves run spec fields onto Claude SDK options', () => {
    const options = resolveClaudeQueryOptions(
      spec,
      '/home/user/.bambuddy/harness/.claude',
    )

    expect(options.cwd).toBe('/work/repo')
    expect(options.model).toBe('deepseek-v4-flash')
    expect(options.agentProgressSummaries).toBe(true)
    expect(options.allowDangerouslySkipPermissions).toBe(true)
    expect(options.disallowedTools).toEqual([...CLAUDE_DISALLOWED_TOOLS])
    expect(options.enableFileCheckpointing).toBe(true)
    expect(options.forwardSubagentText).toBe(true)
    expect(options.includePartialMessages).toBe(true)
    expect(options.permissionMode).toBe('bypassPermissions')
    expect(options.promptSuggestions).toBe(true)
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
    expect(options.effort).toBeUndefined()
    expect(options.resume).toBeUndefined()
    expect(options.forkSession).toBeUndefined()
    expect(options.continue).toBeUndefined()
    expect(options.sessionId).toBeUndefined()
    expect(options.env?.['CLAUDE_CONFIG_DIR']).toBe(
      '/home/user/.bambuddy/harness/.claude',
    )
    expect(options.env?.['ANTHROPIC_BASE_URL']).toBe(
      'https://api.deepseek.com/anthropic',
    )
    expect(options.env?.['ANTHROPIC_API_KEY']).toBe('secret')
    expect(options.env?.['ANTHROPIC_AUTH_TOKEN']).toBe('secret')
    expect(options.env?.['ANTHROPIC_MODEL']).toBeUndefined()
    expect(options.env?.['PATH'] ?? process.env['PATH']).toBe(process.env['PATH'])
  })

  it('omits empty overlay env keys and maps effort, resume, and fork', () => {
    const resume = resolveClaudeQueryOptions(
      { ...spec, effort: 'high', baseUrl: '  ', authToken: '' },
      '/cfg',
      { kind: 'resume', session: { provider: 'claude', id: 'sess-1' } },
    )
    expect(resume.effort).toBe('high')
    expect(resume.resume).toBe('sess-1')
    expect(resume.forkSession).toBeUndefined()
    expect(resume.env?.['ANTHROPIC_BASE_URL']).toBeUndefined()
    expect(resume.env?.['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(resume.env?.['CLAUDE_CONFIG_DIR']).toBe('/cfg')

    const forked = resolveClaudeQueryOptions(
      spec,
      '/cfg',
      { kind: 'fork', source: { provider: 'claude', id: 'sess-1' } },
    )
    expect(forked.resume).toBe('sess-1')
    expect(forked.forkSession).toBe(true)
    expect(forked.sessionId).toBeUndefined()
  })
})
