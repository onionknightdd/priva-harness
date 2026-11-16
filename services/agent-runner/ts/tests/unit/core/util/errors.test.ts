import { describe, expect, it } from 'vitest'

import { errorMessage, hasErrorCode } from '../../../../src/core/util/errors.js'

describe('errorMessage', () => {
  it('reads Error messages and stringifies other thrown values', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(undefined)).toBe('undefined')
  })
})

describe('hasErrorCode', () => {
  it('matches the code of system errors and plain error-shaped objects', () => {
    expect(hasErrorCode(Object.assign(new Error('missing'), { code: 'ENOENT' }), 'ENOENT')).toBe(true)
    expect(hasErrorCode({ code: 'EEXIST' }, 'EEXIST')).toBe(true)
  })

  it('rejects other codes and non-objects', () => {
    expect(hasErrorCode(Object.assign(new Error('missing'), { code: 'ENOENT' }), 'EEXIST')).toBe(false)
    expect(hasErrorCode(new Error('no code'), 'ENOENT')).toBe(false)
    expect(hasErrorCode('ENOENT', 'ENOENT')).toBe(false)
    expect(hasErrorCode(null, 'ENOENT')).toBe(false)
  })
})
