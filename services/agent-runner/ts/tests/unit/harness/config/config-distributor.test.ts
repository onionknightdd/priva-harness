import { describe, expect, it } from 'vitest'

import { emptyHarnessConfig } from '../../../../src/core/config/harness-config.js'
import { ConfigDistributor } from '../../../../src/harness/config/config-distributor.js'
import { FakeConfigAdapter } from '../../../support/fake-config-adapter.js'

const context = { harnessHome: '/tmp/harness', cwd: '/work' }

describe('ConfigDistributor', () => {
  it('reconciles every registered adapter without branching on provider id', async () => {
    const claude = new FakeConfigAdapter('claude')
    const bambuddy = new FakeConfigAdapter('bambuddy')
    const distributor = new ConfigDistributor([claude, bambuddy])

    const report = await distributor.reconcile(emptyHarnessConfig(), context)

    expect(report.results.map((result) => result.provider)).toEqual(['claude', 'bambuddy'])
    expect(claude.applied).toHaveLength(1)
    expect(bambuddy.applied).toHaveLength(1)
  })

  it('limits reconcile to requested targets', async () => {
    const claude = new FakeConfigAdapter('claude')
    const bambuddy = new FakeConfigAdapter('bambuddy')
    const distributor = new ConfigDistributor([claude, bambuddy])

    const report = await distributor.reconcile(emptyHarnessConfig(), context, ['bambuddy'])

    expect(report.results).toEqual([
      { provider: 'bambuddy', applied: 0, skipped: 0, unsupported: [] },
    ])
    expect(claude.applied).toHaveLength(0)
  })

  it('records a provider failure without stopping other adapters', async () => {
    const claude = new FakeConfigAdapter('claude')
    claude.failApply = true
    const bambuddy = new FakeConfigAdapter('bambuddy')
    const distributor = new ConfigDistributor([claude, bambuddy])

    const report = await distributor.reconcile(emptyHarnessConfig(), context)

    expect(report.results[0]).toEqual({
      provider: 'claude',
      applied: 0,
      skipped: 0,
      unsupported: [],
      failed: 'claude apply failed',
    })
    expect(report.results[1]?.provider).toBe('bambuddy')
    expect(bambuddy.applied).toHaveLength(1)
  })
})
