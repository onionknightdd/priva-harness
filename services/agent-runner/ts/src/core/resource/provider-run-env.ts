import type { ProviderId, ProviderRunSpec } from '../contract/agent-provider.js'

export const PI_RUN_PROVIDER_ID = 'priva-chat'

export const CLAUDE_DEFAULT_MODEL_ENV_KEYS = [
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
] as const

const CLAUDE_PROFILE_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  ...CLAUDE_DEFAULT_MODEL_ENV_KEYS,
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
  'CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP',
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
      ...resolveClaudeDefaultModelEnv(spec.model),
      // Default inheritance follows the current model; explicit agent model
      // IDs still win. Disable Explore's Opus cap for custom model IDs.
      CLAUDE_CODE_SUBAGENT_MODEL: 'inherit',
      CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '0',
      CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP: '1',
    })
  }
  return assignedEnv({
    OPENAI_BASE_URL: spec.baseUrl,
    OPENAI_API_KEY: spec.authToken,
  })
}

export function resolveClaudeDefaultModelEnv(model: string): Record<string, string> {
  return assignedEnv(Object.fromEntries(CLAUDE_DEFAULT_MODEL_ENV_KEYS.map((key) => [key, model])))
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
