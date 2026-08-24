import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { piGlobalDir, piProjectDir, piSessionBucketDir } from '../../../../src/provider/pi/pi-paths.js'

describe('pi paths', () => {
  it('relocates native ~/.pi/agent under harness/.pi/agent and keeps project config at cwd/.pi', () => {
    expect(piGlobalDir('/home/user/.bambuddy/harness')).toBe(
      join('/home/user/.bambuddy/harness', '.pi', 'agent'),
    )
    expect(piProjectDir('/work/repo')).toBe(join('/work/repo', '.pi'))
    expect(piSessionBucketDir('/home/user/.bambuddy/harness/.pi/agent', '/work/repo')).toBe(
      join('/home/user/.bambuddy/harness/.pi/agent', 'sessions', '--work-repo--'),
    )
  })
})
