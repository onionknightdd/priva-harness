import { describe, expect, it } from 'vitest'

import { emptyHarnessConfig } from '../../../../src/core/config/harness-config.js'
import { ClaudeConfigAdapter } from '../../../../src/provider/claude/config-adapter/claude-config-adapter.js'

const context = { harnessHome: '/tmp/harness', cwd: '/work' }

describe('ClaudeConfigAdapter', () => {
  it('projects nothing for an empty config', async () => {
    const adapter = new ClaudeConfigAdapter()
    const plan = await adapter.plan(emptyHarnessConfig(), context)
    const result = await adapter.apply(plan)

    expect(plan).toEqual({ provider: 'claude', ops: [], unsupported: [] })
    expect(result).toEqual({
      provider: 'claude',
      applied: 0,
      skipped: 0,
      unsupported: [],
    })
  })

  it('reports mcp and skills instead of dropping them', async () => {
    const adapter = new ClaudeConfigAdapter()
    const plan = await adapter.plan(
      {
        ...emptyHarnessConfig(),
        mcpServers: [{ name: 'vault', enabled: true }],
        skills: [{ name: 'pdf', enabled: true }],
      },
      context,
    )

    expect(plan.ops).toEqual([])
    expect(plan.unsupported).toEqual(['mcp', 'skills'])
  })
})
