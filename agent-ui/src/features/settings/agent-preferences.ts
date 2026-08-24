import {
  isSelectableHarnessId,
  toRunHarnessId,
  type RunHarnessId,
} from "@/features/sidebar/header/harness-options"

export const AGENT_PREFERENCES_STORAGE_KEY = "agent-ui-agent-preferences"

export const DEFAULT_HARNESS_PREFERENCES = ["pi", "claude", "last-used"] as const

export type DefaultHarnessPreference =
  (typeof DEFAULT_HARNESS_PREFERENCES)[number]

export const SESSION_MODEL_PREFERENCES = [
  "profile-default",
  "last-used",
] as const

export type SessionModelPreference =
  (typeof SESSION_MODEL_PREFERENCES)[number]

export const QUEUE_BEHAVIORS = ["follow-up", "steer", "interrupt"] as const

export type QueueBehavior = (typeof QUEUE_BEHAVIORS)[number]

export type AgentPreferences = {
  defaultHarness: DefaultHarnessPreference
  lastHarnessId: RunHarnessId
  sessionModel: SessionModelPreference
  lastModelReference: string | null
  queueBehavior: QueueBehavior
  inputSuggestions: boolean
}

export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
  defaultHarness: "pi",
  lastHarnessId: "pi",
  sessionModel: "profile-default",
  lastModelReference: null,
  queueBehavior: "follow-up",
  inputSuggestions: true,
}

const UNAVAILABLE_STORAGE_ERRORS = new Set([
  "SecurityError",
  "QuotaExceededError",
])

export function isDefaultHarnessPreference(
  value: unknown
): value is DefaultHarnessPreference {
  return (
    typeof value === "string" &&
    (DEFAULT_HARNESS_PREFERENCES as readonly string[]).includes(value)
  )
}

export function isSessionModelPreference(
  value: unknown
): value is SessionModelPreference {
  return (
    typeof value === "string" &&
    (SESSION_MODEL_PREFERENCES as readonly string[]).includes(value)
  )
}

export function isQueueBehavior(value: unknown): value is QueueBehavior {
  return (
    typeof value === "string" &&
    (QUEUE_BEHAVIORS as readonly string[]).includes(value)
  )
}

export function parseComposerModelReference(
  value: string | null | undefined
): { profileId: string; modelId: string } | null {
  const reference = value?.trim() ?? ""
  const separator = reference.indexOf(":")
  if (separator <= 0 || separator >= reference.length - 1) {
    return null
  }

  const profileId = reference.slice(0, separator).trim()
  const modelId = reference.slice(separator + 1).trim()
  if (!profileId || !modelId) {
    return null
  }

  return { profileId, modelId }
}

export function resolveHarnessId(
  defaultHarness: DefaultHarnessPreference,
  lastHarnessId: RunHarnessId
): RunHarnessId {
  if (defaultHarness === "last-used") {
    return lastHarnessId
  }

  return defaultHarness
}

export function parseAgentPreferences(raw: unknown): AgentPreferences {
  if (!isRecord(raw)) {
    return { ...DEFAULT_AGENT_PREFERENCES }
  }

  const lastHarnessId = parseLastHarnessId(raw["lastHarnessId"])
  const lastModelReference = parseLastModelReference(raw["lastModelReference"])

  return {
    defaultHarness: isDefaultHarnessPreference(raw["defaultHarness"])
      ? raw["defaultHarness"]
      : DEFAULT_AGENT_PREFERENCES.defaultHarness,
    lastHarnessId,
    sessionModel: isSessionModelPreference(raw["sessionModel"])
      ? raw["sessionModel"]
      : DEFAULT_AGENT_PREFERENCES.sessionModel,
    lastModelReference,
    inputSuggestions:
      typeof raw["inputSuggestions"] === "boolean"
        ? raw["inputSuggestions"]
        : DEFAULT_AGENT_PREFERENCES.inputSuggestions,
    queueBehavior: DEFAULT_AGENT_PREFERENCES.queueBehavior,
  }
}

export function readStoredAgentPreferences(): AgentPreferences {
  if (typeof window === "undefined") {
    return { ...DEFAULT_AGENT_PREFERENCES }
  }

  try {
    const stored = window.localStorage.getItem(AGENT_PREFERENCES_STORAGE_KEY)
    if (!stored) {
      return { ...DEFAULT_AGENT_PREFERENCES }
    }

    return parseAgentPreferences(JSON.parse(stored) as unknown)
  } catch (error) {
    if (isUnavailableStorageError(error) || error instanceof SyntaxError) {
      return { ...DEFAULT_AGENT_PREFERENCES }
    }

    throw error
  }
}

export function storeAgentPreferences(preferences: AgentPreferences) {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(
      AGENT_PREFERENCES_STORAGE_KEY,
      JSON.stringify(toStoredAgentPreferences(preferences))
    )
  } catch (error) {
    if (!isUnavailableStorageError(error)) {
      throw error
    }
  }
}

function toStoredAgentPreferences(preferences: AgentPreferences) {
  return {
    defaultHarness: preferences.defaultHarness,
    lastHarnessId: preferences.lastHarnessId,
    sessionModel: preferences.sessionModel,
    lastModelReference: preferences.lastModelReference,
    inputSuggestions: preferences.inputSuggestions,
  }
}

function parseLastHarnessId(value: unknown): RunHarnessId {
  if (typeof value === "string" && isSelectableHarnessId(value)) {
    return toRunHarnessId(value) ?? DEFAULT_AGENT_PREFERENCES.lastHarnessId
  }

  return DEFAULT_AGENT_PREFERENCES.lastHarnessId
}

function parseLastModelReference(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const parsed = parseComposerModelReference(value)
  return parsed ? `${parsed.profileId}:${parsed.modelId}` : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUnavailableStorageError(error: unknown) {
  return (
    error instanceof DOMException && UNAVAILABLE_STORAGE_ERRORS.has(error.name)
  )
}
