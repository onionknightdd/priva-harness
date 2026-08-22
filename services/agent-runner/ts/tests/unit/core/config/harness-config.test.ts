import { describe, expect, it } from 'vitest'

import { emptyHarnessConfig } from '../../../../src/core/config/harness-config.js'
import {
  mergeProjectionSlices,
  unhandledResourceSlice,
} from '../../../../src/core/config/projection-plan.js'

describe('projection plan helpers', () => {
  it('marks a present resource as unsupported without inventing writes', () => {
    expect(unhandledResourceSlice('mcp', true)).toEqual({
      ops: [],
      unsupported: ['mcp'],
    })
    expect(unhandledResourceSlice('mcp', false)).toEqual({
      ops: [],
      unsupported: [],
    })
  })

  it('concatenates provider-owned slices', () => {
    expect(
      mergeProjectionSlices('claude', [
        unhandledResourceSlice('mcp', true),
        unhandledResourceSlice('skills', false),
      ]),
    ).toEqual({
      provider: 'claude',
      ops: [],
      unsupported: ['mcp'],
    })
  })
})

describe('emptyHarnessConfig', () => {
  it('starts with no mcp servers or skills', () => {
    expect(emptyHarnessConfig()).toEqual({
      revision: '0',
      scope: { kind: 'global' },
      mcpServers: [],
      skills: [],
    })
  })
})
