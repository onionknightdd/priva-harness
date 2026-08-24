import type { RuntimeSettings } from '../resource/runtime-settings.js'

export interface RuntimeSettingsTransaction<T> {
  readonly settings: RuntimeSettings
  readonly result: T
}

export interface RuntimeSettingsStore {
  readonly filePath: string

  read(): Promise<RuntimeSettings>

  transact<T>(
    operation: (settings: RuntimeSettings) => RuntimeSettingsTransaction<T>,
  ): Promise<T>
}
