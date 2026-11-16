import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveInside } from '../../../../src/core/util/paths.js'

describe('resolveInside', () => {
  const root = path.resolve('/work/space')

  it('resolves relative and absolute descendants', () => {
    expect(resolveInside(root, 'a/b.png')).toBe(path.join(root, 'a', 'b.png'))
    expect(resolveInside(root, path.join(root, 'c.png'))).toBe(path.join(root, 'c.png'))
  })

  it('accepts names that only begin with dots', () => {
    expect(resolveInside(root, '..draft.png')).toBe(path.join(root, '..draft.png'))
    expect(resolveInside(root, '...')).toBe(path.join(root, '...'))
  })

  it('rejects the root itself and anything outside it', () => {
    expect(resolveInside(root, '.')).toBeUndefined()
    expect(resolveInside(root, '..')).toBeUndefined()
    expect(resolveInside(root, '../sibling/file')).toBeUndefined()
    expect(resolveInside(root, 'a/../../escape')).toBeUndefined()
    expect(resolveInside(root, '/etc/passwd')).toBeUndefined()
  })
})
