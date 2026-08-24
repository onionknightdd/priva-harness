import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createRuntimeConfig,
  defaultRuntimeHome,
  resolveRuntimeHome,
  runtimeConfig,
  RUNTIME_HOME_ENV,
} from '../../src/runtime-config.js'

describe('runtimeConfig', () => {
  it('defaults to ~/.bambuddy with settings and harness paths', () => {
    const runtimeHome = join(homedir(), '.bambuddy')

    expect(defaultRuntimeHome()).toBe(runtimeHome)
    expect(runtimeConfig).toEqual({
      runtimeHome,
      settingsFilePath: join(runtimeHome, 'bambuddy.settings.json'),
      harnessHome: join(runtimeHome, 'harness'),
    })
    expect(Object.isFrozen(runtimeConfig)).toBe(true)
    expect(RUNTIME_HOME_ENV).toBe('RUNTIME_HOME_DIR')
  })

  it('resolves an absolute override and expands a home-relative path', () => {
    expect(resolveRuntimeHome('/var/bambuddy')).toBe(resolve('/var/bambuddy'))
    expect(resolveRuntimeHome('~/agents')).toBe(join(homedir(), 'agents'))
    expect(resolveRuntimeHome('')).toBe(defaultRuntimeHome())
    expect(resolveRuntimeHome(undefined)).toBe(defaultRuntimeHome())
  })

  it('builds a runtime config under a custom home', () => {
    const runtimeHome = '/tmp/bambuddy-home'
    expect(createRuntimeConfig(runtimeHome)).toEqual({
      runtimeHome: resolve(runtimeHome),
      settingsFilePath: join(runtimeHome, 'bambuddy.settings.json'),
      harnessHome: join(runtimeHome, 'harness'),
    })
  })

  it('rejects an empty runtime home', () => {
    expect(() => createRuntimeConfig('  ')).toThrow(TypeError)
  })
})
