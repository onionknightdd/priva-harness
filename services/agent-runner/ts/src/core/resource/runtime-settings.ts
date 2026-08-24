import {
  isQueueBehavior,
  type QueueBehavior,
} from '../contract/agent-provider.js'
import {
  emptyModelProfileCollection,
  parseModelProfileCollection,
  type ModelProfileCollection,
} from './model-profile.js'

export const RUNTIME_SETTINGS_VERSION = 1

export interface AgentProfile {
  readonly queueBehavior: QueueBehavior
}

export interface RuntimeSettings {
  readonly version: number
  readonly modelProfiles: ModelProfileCollection
  readonly agentProfile: AgentProfile
}

export type RuntimeSettingsErrorKind =
  | 'invalid-queue-behavior'
  | 'io-failure'
  | 'store-corrupt'

export class RuntimeSettingsError extends Error {
  readonly kind: RuntimeSettingsErrorKind

  constructor(kind: RuntimeSettingsErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RuntimeSettingsError'
    this.kind = kind
  }
}

export function emptyAgentProfile(): AgentProfile {
  return { queueBehavior: 'follow-up' }
}

export function emptyRuntimeSettings(): RuntimeSettings {
  return {
    version: RUNTIME_SETTINGS_VERSION,
    modelProfiles: emptyModelProfileCollection(),
    agentProfile: emptyAgentProfile(),
  }
}

export function parseRuntimeSettings(value: unknown): RuntimeSettings {
  if (!isRecord(value)) {
    throw corruptSettings('Settings file must contain an object')
  }
  assertOnlyStoredKeys(value, ['version', 'modelProfiles', 'agentProfile'], 'Settings')
  if (value['version'] !== RUNTIME_SETTINGS_VERSION) {
    throw corruptSettings(`Unsupported settings version: ${String(value['version'])}`)
  }

  let modelProfiles: ModelProfileCollection
  try {
    modelProfiles = parseModelProfileCollection(value['modelProfiles'])
  } catch (error) {
    throw corruptSettings('Settings modelProfiles block is invalid', error)
  }

  return {
    version: RUNTIME_SETTINGS_VERSION,
    modelProfiles,
    agentProfile: parseAgentProfile(value['agentProfile']),
  }
}

export function serializeRuntimeSettings(settings: RuntimeSettings): unknown {
  return {
    version: RUNTIME_SETTINGS_VERSION,
    modelProfiles: serializeModelProfilesBlock(settings.modelProfiles),
    agentProfile: {
      queueBehavior: settings.agentProfile.queueBehavior,
    },
  }
}

export function parseAgentProfile(value: unknown): AgentProfile {
  if (!isRecord(value)) {
    throw corruptSettings('agentProfile must be an object')
  }
  assertOnlyStoredKeys(value, ['queueBehavior'], 'agentProfile')
  const queueBehavior = value['queueBehavior']
  if (!isQueueBehavior(queueBehavior)) {
    throw new RuntimeSettingsError(
      'invalid-queue-behavior',
      'agentProfile.queueBehavior must be follow-up, steer, or interrupt',
    )
  }
  return { queueBehavior }
}

function serializeModelProfilesBlock(collection: ModelProfileCollection): unknown {
  return {
    defaultProfileId: collection.defaultProfileId,
    profiles: collection.profiles,
  }
}

function corruptSettings(message: string, cause?: unknown): RuntimeSettingsError {
  return new RuntimeSettingsError(
    'store-corrupt',
    message,
    cause === undefined ? undefined : { cause },
  )
}

function assertOnlyStoredKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  context: string,
): void {
  const allowed = new Set(allowedKeys)
  const unsupported = Object.keys(value).find((key) => !allowed.has(key))
  if (unsupported !== undefined) {
    throw corruptSettings(`${context} contains unsupported field: ${unsupported}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
