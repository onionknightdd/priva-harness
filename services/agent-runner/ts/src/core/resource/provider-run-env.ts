import type { ProviderId, ProviderRunSpec } from '../contract/agent-provider.js'

export const PI_RUN_PROVIDER_ID = 'openai'

const CLAUDE_PROFILE_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
] as const

const PI_PROFILE_ENV_KEYS = [
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
] as const

export function assignedEnv(
  entries: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(entries)) {
    const trimmed = value?.trim() ?? ''
    if (trimmed === '') continue
    env[key] = trimmed
  }
  return env
}

export function resolveProviderRunEnv(
  spec: Pick<ProviderRunSpec, 'provider' | 'model' | 'baseUrl' | 'authToken'>,
): Record<string, string> {
  if (spec.provider === 'claude') {
    return assignedEnv({
      ANTHROPIC_BASE_URL: spec.baseUrl,
      ANTHROPIC_API_KEY: spec.authToken,
      ANTHROPIC_AUTH_TOKEN: spec.authToken,
      ANTHROPIC_MODEL: spec.model,
    })
  }
  return assignedEnv({
    OPENAI_BASE_URL: spec.baseUrl,
    OPENAI_API_KEY: spec.authToken,
  })
}

export function profileEnvKeys(provider: ProviderId): readonly string[] {
  return provider === 'claude' ? CLAUDE_PROFILE_ENV_KEYS : PI_PROFILE_ENV_KEYS
}

export function mergeProviderProcessEnv(
  overlay: Readonly<Record<string, string>>,
  omitted: ReadonlySet<string>,
  extra: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || omitted.has(key)) continue
    env[key] = value
  }
  Object.assign(env, overlay, assignedEnv(extra))
  return env
}
