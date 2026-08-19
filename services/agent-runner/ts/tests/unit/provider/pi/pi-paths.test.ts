import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { piGlobalDir, piProjectDir } from '../../../../src/provider/pi/pi-paths.js'

describe('pi paths', () => {
  it('places productized global config under harness/.bambuddy and project config under cwd/.bambuddy', () => {
    expect(piGlobalDir('/home/user/.bambuddy/harness')).toBe(
      join('/home/user/.bambuddy/harness', '.bambuddy'),
    )
    expect(piProjectDir('/work/repo')).toBe(join('/work/repo', '.bambuddy'))
    expect(piProjectDir('/work/repo')).not.toContain('/.pi')
  })
})
