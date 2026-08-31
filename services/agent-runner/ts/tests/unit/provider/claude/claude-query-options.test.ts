import { describe, expect, it } from 'vitest'

import {
  CLAUDE_DISALLOWED_TOOLS,
  resolveClaudeQueryOptions,
  resolveClaudeQuerySettings,
} from '../../../../src/provider/claude/claude-runtime.js'
import { productTools } from '../../../../src/core/tool/product-tools.js'
import { PRODUCT_MCP_TOOL_TIMEOUT_MS } from '../../../../src/provider/claude/tools/compile-custom-tools.js'

const spec = {
  cwd: '/work/repo',
  provider: 'claude' as const,
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/anthropic',
  authToken: 'secret',
}

describe('resolveClaudeQuerySettings', () => {
  it('puts the profile overlay on flag-tier settings.env', () => {
    expect(resolveClaudeQuerySettings(spec).env).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_API_KEY: 'secret',
      ANTHROPIC_AUTH_TOKEN: 'secret',
      ANTHROPIC_MODEL: 'deepseek-v4-flash',
    })
    expect(
      resolveClaudeQuerySettings({
        ...spec,
        baseUrl: '  ',
        authToken: '',
      }).env,
    ).toEqual({
      ANTHROPIC_MODEL: 'deepseek-v4-flash',
    })
  })
})

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
    expect(options.disallowedTools).toContain('DesignSync')
    expect(options.disallowedTools).not.toContain('CronCreate')
    expect(options.disallowedTools).not.toContain('CronDelete')
    expect(options.disallowedTools).not.toContain('CronList')
    expect(options.disallowedTools).toContain('ScheduleWakeup')
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
    expect(options.env?.['ANTHROPIC_MODEL']).toBe('deepseek-v4-flash')
    expect(options.env?.['CLAUDE_CODE_HARBOR_KITE']).toBe('1')
    expect(options.settings).toEqual(resolveClaudeQuerySettings(spec))
    expect(options.settings).toMatchObject({
      env: {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_API_KEY: 'secret',
        ANTHROPIC_AUTH_TOKEN: 'secret',
        ANTHROPIC_MODEL: 'deepseek-v4-flash',
      },
    })
    expect(options.extraArgs).toBeUndefined()
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
    expect(resume.env?.['ANTHROPIC_MODEL']).toBe('deepseek-v4-flash')
    expect(resume.env?.['CLAUDE_CONFIG_DIR']).toBe('/cfg')
    expect(resume.settings).toEqual(
      resolveClaudeQuerySettings({
        ...spec,
        baseUrl: '  ',
        authToken: '',
      }),
    )

    const forked = resolveClaudeQueryOptions(
      spec,
      '/cfg',
      { kind: 'fork', source: { provider: 'claude', id: 'sess-1' } },
    )
    expect(forked.resume).toBe('sess-1')
    expect(forked.forkSession).toBe(true)
    expect(forked.sessionId).toBeUndefined()
  })

  it('sets sessionId from a preassigned Claude session without forcing a title', () => {
    const options = resolveClaudeQueryOptions(
      spec,
      '/cfg',
      { kind: 'new', provider: 'claude', sessionId: '11111111-1111-4111-8111-111111111111' },
    )
    expect(options.sessionId).toBe('11111111-1111-4111-8111-111111111111')
    expect(options.extraArgs).toBeUndefined()
    expect(options.title).toBeUndefined()

    const resumed = resolveClaudeQueryOptions(
      spec,
      '/cfg',
      { kind: 'resume', session: { provider: 'claude', id: 'sess-1' } },
    )
    expect(resumed.sessionId).toBeUndefined()
    expect(resumed.extraArgs).toBeUndefined()
    expect(resumed.title).toBeUndefined()

    const forked = resolveClaudeQueryOptions(
      spec,
      '/cfg',
      {
        kind: 'fork',
        source: { provider: 'claude', id: 'sess-1' },
        sessionId: '22222222-2222-4222-8222-222222222222',
      },
    )
    expect(forked.sessionId).toBe('22222222-2222-4222-8222-222222222222')
    expect(forked.extraArgs).toBeUndefined()
    expect(forked.title).toBeUndefined()
  })

  it('disables prompt suggestions when the run spec asks', () => {
    const options = resolveClaudeQueryOptions(
      { ...spec, promptSuggestions: false },
      '/cfg',
    )
    expect(options.promptSuggestions).toBe(false)
  })

  it('compiles product tools into an SDK MCP server', () => {
    const options = resolveClaudeQueryOptions(
      spec,
      '/cfg',
      { kind: 'new', provider: 'claude' },
      undefined,
      productTools,
    )
    expect(options.toolAliases).toEqual({
      visualize: 'mcp__agentWorkshop__visualize',
      canvas: 'mcp__agentWorkshop__canvas',
      image_gen: 'mcp__agentWorkshop__image_gen',
      image_read: 'mcp__agentWorkshop__image_read',
      image_edit: 'mcp__agentWorkshop__image_edit',
    })
    expect(options.mcpServers).toMatchObject({
      agentWorkshop: {
        type: 'sdk',
        name: 'agentWorkshop',
        timeout: PRODUCT_MCP_TOOL_TIMEOUT_MS,
      },
    })
  })
})
