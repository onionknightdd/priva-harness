import { homedir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { piGlobalDir, piProjectDir, piSessionBucketDir } from '../../../../src/provider/pi/pi-paths.js'

describe('pi paths', () => {
  beforeEach(() => {
    vi.stubEnv('PI_CODING_AGENT_DIR', undefined)
    vi.stubEnv('RUNTIME_HOME_DIR', '/product-runtime')
  })

  afterEach(() => { vi.unstubAllEnvs() })

  it('uses the native global directory independently of the product runtime home', () => {
    expect(piGlobalDir()).toBe(join(homedir(), '.pi', 'agent'))
    expect(process.env['PI_CODING_AGENT_DIR']).toBeUndefined()
  })

  it('uses the SDK to expand an inherited directory', () => {
    vi.stubEnv('PI_CODING_AGENT_DIR', '~/native-pi')
    expect(piGlobalDir()).toBe(join(homedir(), 'native-pi'))
    expect(process.env['PI_CODING_AGENT_DIR']).toBe('~/native-pi')
  })

  it('keeps project config and session buckets in their native locations', () => {
    expect(piProjectDir('/work/repo')).toBe(join('/work/repo', '.pi'))
    expect(piSessionBucketDir('/home/user/.pi/agent', '/work/repo')).toBe(
      join('/home/user/.pi/agent', 'sessions', '--work-repo--'),
    )
  })
})
