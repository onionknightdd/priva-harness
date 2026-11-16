import { describe, expect, it } from 'vitest'

import { RecentMap } from '../../../../src/core/util/recent-map.js'

describe('RecentMap', () => {
  it('drops the least recently written key beyond its limit', () => {
    const map = new RecentMap<string, number>(2)
    map.set('a', 1)
    map.set('b', 2)
    map.set('a', 3)
    map.set('c', 4)

    expect(map.has('b')).toBe(false)
    expect(map.get('a')).toBe(3)
    expect(map.get('c')).toBe(4)
    expect(map.size).toBe(2)
  })

  it('rejects a limit that could hold nothing', () => {
    expect(() => new RecentMap(0)).toThrow(RangeError)
  })
})
