import { describe, expect, it } from 'vitest'

import { isModelFile, modelExtension } from '../../../../src/core/resource/model-file.js'

describe('model file names', () => {
  it('reads the extension case-insensitively', () => {
    expect(modelExtension('Part.STL')).toBe('stl')
    expect(isModelFile('scan.final.laz')).toBe(true)
  })

  it('does not treat an extension-less name as its own extension', () => {
    expect(modelExtension('stl')).toBe('')
    expect(isModelFile('step')).toBe(false)
    expect(isModelFile('.obj')).toBe(false)
  })
})
