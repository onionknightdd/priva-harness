import { describe, expect, it } from 'vitest'

import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'

describe('LiveRunRegistry', () => {
  it('indexes a session and removes it when the run finishes', () => {
    const registry = new LiveRunRegistry()
    registry.start({ runId: 'run-1', provider: 'claude', cwd: '/work' })
    registry.attachSession('run-1', 'sess-1')
    expect(registry.liveForSession({ provider: 'claude', id: 'sess-1' })?.runId).toBe('run-1')
    expect(registry.listActive('claude')).toHaveLength(1)
    registry.finish('run-1')
    expect(registry.liveForSession({ provider: 'claude', id: 'sess-1' })).toBeUndefined()
    expect(registry.listActive()).toEqual([])
  })
})
