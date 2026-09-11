import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const RUNTIME_HOME_ENV = 'RUNTIME_HOME_DIR'

const RUNTIME_HOME_DIRECTORY = '.bambuddy'
const SETTINGS_FILE_NAME = 'bambuddy.settings.json'
const HARNESS_DIRECTORY = 'harness'
const DATA_FILE_NAME = '.data.db'

export interface RuntimeConfig {
  readonly runtimeHome: string
  readonly settingsFilePath: string
  readonly harnessHome: string
  // Usage and audit SQLite database. User-level state shared by every harness
  // provider, hence beside the settings file rather than under harness/.
  readonly dataFilePath: string
}

export function defaultRuntimeHome(): string {
  return join(homedir(), RUNTIME_HOME_DIRECTORY)
}

export function resolveRuntimeHome(override: string | undefined): string {
  if (override === undefined) return defaultRuntimeHome()
  const trimmed = override.trim()
  if (trimmed === '') return defaultRuntimeHome()
  return resolve(expandHomeDirectory(trimmed))
}

export function createRuntimeConfig(runtimeHome: string): RuntimeConfig {
  if (runtimeHome.trim() === '') {
    throw new TypeError('runtimeHome must not be empty')
  }
  const home = resolve(runtimeHome)
  return Object.freeze({
    runtimeHome: home,
    settingsFilePath: join(home, SETTINGS_FILE_NAME),
    harnessHome: join(home, HARNESS_DIRECTORY),
    dataFilePath: join(home, DATA_FILE_NAME),
  })
}

export const runtimeConfig: RuntimeConfig = createRuntimeConfig(defaultRuntimeHome())

function expandHomeDirectory(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}
