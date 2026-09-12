// Folds UTC instants into the caller's calendar. The store keeps ts_utc only;
// "which day was that" is answered at query time for the IANA zone the
// client sends, so a user who travels sees the same facts re-bucketed.

const formatters = new Map<string, Intl.DateTimeFormat>()

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone)
    return true
  } catch {
    return false
  }
}

export interface LocalDateParts {
  readonly date: string
  readonly hour: number
}

export function localDateParts(instant: Date, timeZone: string): LocalDateParts {
  const parts = formatterFor(timeZone).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? ''
  // en-CA yields YYYY-MM-DD; hour '24' appears for midnight in some engines.
  const hour = Number(get('hour')) % 24
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour }
}

export function localDate(instant: Date, timeZone: string): string {
  return localDateParts(instant, timeZone).date
}

// Calendar arithmetic on YYYY-MM-DD strings, independent of any zone.
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days))
  return shifted.toISOString().slice(0, 10)
}

export function daysBetween(earlier: string, later: string): number {
  const toUtc = (date: string): number => {
    const [year, month, day] = date.split('-').map(Number)
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  }
  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000)
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}
