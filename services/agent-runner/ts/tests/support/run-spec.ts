import { PLATFORM_INSTRUCTIONS } from '../../src/harness/prompt/platform-instructions.js'
import type { ProviderRunSpec } from '../../src/core/contract/agent-provider.js'

export function testRunSpec(overrides: Partial<ProviderRunSpec> = {}): ProviderRunSpec {
  return {
    cwd: '/tmp',
    provider: 'claude',
    model: 'm',
    baseUrl: 'https://api.example.com',
    authToken: 'token',
    ...(overrides.provider === 'pi' ? {} : { runMode: 'code' as const, systemInstructions: PLATFORM_INSTRUCTIONS }),
    ...overrides,
  }
}
