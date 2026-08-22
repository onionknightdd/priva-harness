import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { piGlobalDir, piProjectDir, piSessionBucketDir } from '../../../../src/provider/pi/pi-paths.js'

describe('pi paths', () => {
  it('places productized global config under harness/.bambuddy and project config under cwd/.bambuddy', () => {
    expect(piGlobalDir('/home/user/.bambuddy/harness')).toBe(
      join('/home/user/.bambuddy/harness', '.bambuddy'),
    )
    expect(piProjectDir('/work/repo')).toBe(join('/work/repo', '.bambuddy'))
    expect(piSessionBucketDir('/home/user/.bambuddy/harness/.bambuddy', '/work/repo')).toBe(
      join('/home/user/.bambuddy/harness/.bambuddy', 'sessions', '--work-repo--'),
    )
  })
})
