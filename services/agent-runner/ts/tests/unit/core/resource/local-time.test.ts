import { describe, expect, it } from 'vitest'

import { daysBetween, isValidTimeZone, localDate, localDateParts, shiftDate } from '../../../../src/core/resource/local-time.js'

describe('local-time', () => {
  it('folds a UTC instant into the calendar day and hour of the given zone', () => {
    const instant = new Date('2026-09-11T16:30:00.000Z')
    expect(localDateParts(instant, 'Asia/Shanghai')).toEqual({ date: '2026-09-12', hour: 0 })
    expect(localDateParts(instant, 'UTC')).toEqual({ date: '2026-09-11', hour: 16 })
    expect(localDateParts(instant, 'America/Los_Angeles')).toEqual({ date: '2026-09-11', hour: 9 })
    expect(localDate(new Date('2026-09-11T15:59:59.999Z'), 'Asia/Shanghai')).toBe('2026-09-11')
  })

  it('handles half-hour zones and DST transitions through Intl', () => {
    expect(localDateParts(new Date('2026-09-11T18:45:00.000Z'), 'Asia/Kolkata')).toEqual({ date: '2026-09-12', hour: 0 })
    // Europe/Berlin is UTC+2 in summer and UTC+1 in winter.
    expect(localDate(new Date('2026-07-01T22:30:00.000Z'), 'Europe/Berlin')).toBe('2026-07-02')
    expect(localDate(new Date('2026-12-01T22:30:00.000Z'), 'Europe/Berlin')).toBe('2026-12-01')
  })

  it('does calendar arithmetic on date strings', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29')
    expect(shiftDate('2026-01-01', -365)).toBe('2025-01-01')
    expect(daysBetween('2026-09-10', '2026-09-12')).toBe(2)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
  })

  it('rejects unknown zones without throwing', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})
