import { describe, expect, it } from 'vitest'

import { encodeReadView } from '../../../../src/core/event/tool-read.js'

describe('encodeReadView', () => {
  it('encodes Claude FileReadOutput text with file startLine', () => {
    expect(encodeReadView({
      type: 'text',
      file: {
        filePath: 'src/a.ts',
        content: 'const a = 1',
        numLines: 1,
        startLine: 12,
        totalLines: 40,
      },
    })).toBe(JSON.stringify({
      $read: 'text',
      content: 'const a = 1',
      startLine: 12,
    }))
  })

  it('encodes Claude FileReadOutput image bytes', () => {
    expect(encodeReadView({
      type: 'image',
      file: {
        base64: 'abc',
        type: 'image/png',
        originalSize: 12,
        dimensions: { displayWidth: 80, displayHeight: 40 },
      },
    })).toBe(JSON.stringify({
      $read: 'image',
      mime: 'image/png',
      b64: 'abc',
      width: 80,
      height: 40,
    }))
  })

  it('normalizes a short image type onto an image mime', () => {
    expect(JSON.parse(encodeReadView({
      type: 'image',
      file: { base64: 'abc', type: 'jpeg' },
    }))).toEqual({
      $read: 'image',
      mime: 'image/jpeg',
      b64: 'abc',
    })
  })

  it('strips cat -n prefixes from a text snippet', () => {
    expect(encodeReadView('    12\tconst a = 1\n    13\tconst b = 2\n')).toBe(
      JSON.stringify({
        $read: 'text',
        content: 'const a = 1\nconst b = 2',
        startLine: 12,
      }),
    )
  })

  it('encodes Pi image content blocks', () => {
    expect(encodeReadView({
      content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
    })).toBe(JSON.stringify({
      $read: 'image',
      mime: 'image/png',
      b64: 'abc',
    }))
  })

  it('does not treat PDF FileReadOutput as an image', () => {
    expect(encodeReadView({
      type: 'pdf',
      file: { filePath: 'a.pdf', base64: 'abc', originalSize: 8 },
    })).toBe('')
  })
})
