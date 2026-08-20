import type { ProviderRunSpec } from '../../src/core/contract/agent-provider.js'

export function testRunSpec(overrides: Partial<ProviderRunSpec> = {}): ProviderRunSpec {
  return {
    cwd: '/tmp',
    provider: 'claude',
    model: 'm',
    baseUrl: 'https://api.example.com',
    authToken: 'token',
    ...overrides,
  }
}
