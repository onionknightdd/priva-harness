import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runtimeConfig } from '../../src/runtime-config.js'

describe('runtimeConfig', () => {
  it('exports the fixed Bambuddy runtime and settings paths', () => {
    const runtimeHome = join(homedir(), '.bambuddy')

    expect(runtimeConfig).toEqual({
      runtimeHome,
      settingsFilePath: join(runtimeHome, 'bambuddy.settings.yml'),
    })
    expect(Object.isFrozen(runtimeConfig)).toBe(true)
  })
})
