import { describe, expect, it } from 'vitest'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { getBuiltinModel } from '@earendil-works/pi-ai/providers/all'
import { resolvePiThinkingCapability } from '../../../../src/provider/pi/pi-thinking-levels.js'
import { buildPiModelsConfig } from '../../../../src/provider/pi/pi-models-config.js'
import { piTerminalCommandSchema } from '../../../../src/provider/pi/pi-terminal-protocol.js'

describe('Pi thinking capabilities', () => {
  it('uses the exact DeepSeek catalog capabilities with an explicit Responses off value', () => {
    const native = getBuiltinModel('deepseek', 'deepseek-flash')
    const capability = resolvePiThinkingCapability('deepseek-flash')
    expect(capability.reasoning).toBe(true)
    expect(capability.effortLevels).toEqual(getSupportedThinkingLevels(native))
    expect(capability.effortLevels).toEqual(['off', 'low', 'high', 'max'])
    expect(capability.thinkingLevelMap).toEqual({ ...native.thinkingLevelMap, off: 'none' })
    const config = buildPiModelsConfig('https://profile.test', 'deepseek-flash').providers['priva-chat']
    expect(config.api).toBe('openai-responses')
    expect(config.models[0]).toMatchObject({ reasoning: true, thinkingLevelMap: capability.thinkingLevelMap })
    expect(config.compat).not.toHaveProperty('thinkingFormat')
  })

  it('does not infer aliases or reuse conflicting provider capabilities', () => {
    for (const id of ['my-deepseek-flash', 'unknown-model', 'deepseek-v4-flash']) {
      expect(resolvePiThinkingCapability(id)).toEqual({ reasoning: false, effortLevels: ['off'] })
    }
  })

  it.each(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])('accepts the native %s configuration level', (effort) => {
    expect(piTerminalCommandSchema.parse({ type: 'configure', model: 'deepseek-flash', contextWindow: 200_000, effort })).toHaveProperty('effort', effort)
  })
})
