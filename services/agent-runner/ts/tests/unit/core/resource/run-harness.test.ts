import { describe, expect, it } from 'vitest'

import {
  providerIdForHarness,
  rewriteProviderBaseUrl,
} from '../../../../src/core/resource/run-harness.js'

describe('rewriteProviderBaseUrl', () => {
  it('strips a trailing /v1 for Claude Code and leaves other paths alone', () => {
    expect(rewriteProviderBaseUrl('https://api.deepseek.com/v1', 'claude')).toBe(
      'https://api.deepseek.com',
    )
    expect(rewriteProviderBaseUrl('https://api.deepseek.com/anthropic', 'claude')).toBe(
      'https://api.deepseek.com/anthropic',
    )
  })

  it('adds /v1 for Bambuddy when it is missing', () => {
    expect(rewriteProviderBaseUrl('https://api.deepseek.com', 'bambuddy')).toBe(
      'https://api.deepseek.com/v1',
    )
    expect(rewriteProviderBaseUrl('https://api.deepseek.com/v1/', 'bambuddy')).toBe(
      'https://api.deepseek.com/v1',
    )
  })

  it('maps bambuddy to the Pi provider', () => {
    expect(providerIdForHarness('claude')).toBe('claude')
    expect(providerIdForHarness('bambuddy')).toBe('pi')
  })
})
