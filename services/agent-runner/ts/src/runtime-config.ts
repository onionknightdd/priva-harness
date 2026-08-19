import { homedir } from 'node:os'
import { join } from 'node:path'

const RUNTIME_HOME_DIRECTORY = '.bambuddy'
const SETTINGS_FILE_NAME = 'bambuddy.settings.yml'

export interface RuntimeConfig {
  readonly runtimeHome: string
  readonly settingsFilePath: string
}

const runtimeHome = join(homedir(), RUNTIME_HOME_DIRECTORY)

export const runtimeConfig: RuntimeConfig = Object.freeze({
  runtimeHome,
  settingsFilePath: join(runtimeHome, SETTINGS_FILE_NAME),
})
