import { describe, expect, it } from 'vitest'

import {
  assignedEnv,
  resolveProviderRunEnv,
} from '../../../../src/core/resource/provider-run-env.js'

describe('resolveProviderRunEnv', () => {
  it('maps a Claude profile onto Anthropic option env', () => {
    expect(
      resolveProviderRunEnv({
        provider: 'claude',
        model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com/anthropic',
        authToken: 'secret',
      }),
    ).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_API_KEY: 'secret',
      ANTHROPIC_AUTH_TOKEN: 'secret',
      ANTHROPIC_MODEL: 'deepseek-v4-flash',
    })
  })

  it('maps a Pi profile onto OpenAI option env', () => {
    expect(
      resolveProviderRunEnv({
        provider: 'pi',
        model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com/v1',
        authToken: 'secret',
      }),
    ).toEqual({
      OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
      OPENAI_API_KEY: 'secret',
    })
  })

  it('omits empty profile fields', () => {
    expect(
      resolveProviderRunEnv({
        provider: 'claude',
        model: 'm',
        baseUrl: '  ',
        authToken: '',
      }),
    ).toEqual({
      ANTHROPIC_MODEL: 'm',
    })
  })
})

describe('assignedEnv', () => {
  it('drops blank values', () => {
    expect(assignedEnv({ A: 'x', B: '  ', C: undefined })).toEqual({ A: 'x' })
  })
})
