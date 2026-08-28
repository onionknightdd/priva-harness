import { describe, expect, it } from 'vitest'

import {
  encodeBase32,
  imageArtifactFileName,
  imageExtensionForMime,
  resolveImageArtifactPath,
  resolveWorkspaceFilePath,
} from '../../../../src/core/tool/image-artifact.js'

describe('image artifacts', () => {
  it('encodes truncated hashes as lowercase base32 filenames', () => {
    expect(encodeBase32(Uint8Array.from([0x00]))).toBe('aa')
    expect(imageExtensionForMime('image/jpeg')).toBe('jpg')
    expect(imageArtifactFileName(Uint8Array.from([1, 2, 3]), 'image/png')).toMatch(
      /^[a-z2-7]+\.png$/,
    )
  })

  it('keeps generated files inside .images and source files inside the workspace', () => {
    expect(resolveImageArtifactPath('/work', 'abcde.png')).toBe(
      '/work/.images/abcde.png',
    )
    expect(() => resolveImageArtifactPath('/work', '../secret.png')).toThrow(
      'image path must stay inside .images',
    )
    expect(resolveWorkspaceFilePath('/work', 'shot.png')).toBe('/work/shot.png')
    expect(() => resolveWorkspaceFilePath('/work', '../secret.png')).toThrow(
      'path must stay inside the workspace',
    )
  })
})
