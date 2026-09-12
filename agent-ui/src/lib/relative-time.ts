import * as React from "react"

const RELATIVE_UNITS = [
  { unit: "year", ms: 1000 * 60 * 60 * 24 * 365 },
  { unit: "month", ms: 1000 * 60 * 60 * 24 * 30 },
  { unit: "week", ms: 1000 * 60 * 60 * 24 * 7 },
  { unit: "day", ms: 1000 * 60 * 60 * 24 },
  { unit: "hour", ms: 1000 * 60 * 60 },
  { unit: "minute", ms: 1000 * 60 },
  { unit: "second", ms: 1000 },
] as const

const JUST_NOW_MS = 45_000
const TICK_MS = 15_000

export type RelativeTimeLabel = {
  label: string
  dateTime: string
  absoluteLabel: string
}

// Intl constructors cost hundreds of microseconds each; a transcript formats
// one label per message on every render, so formatters are cached per locale.
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>()
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()

function absoluteFormatter(locale: string) {
  let formatter = absoluteFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    })
    absoluteFormatters.set(locale, formatter)
  }
  return formatter
}

function relativeFormatter(locale: string) {
  let formatter = relativeFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" })
    relativeFormatters.set(locale, formatter)
  }
  return formatter
}

export function sessionTimestampToMs(timestamp: number): number | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null
  }

  if (timestamp > 1e12) {
    return timestamp
  }

  if (timestamp > 1e9) {
    return timestamp * 1000
  }

  return null
}

export function formatSessionRelativeTime(
  timestamp: number,
  locale: string,
  justNow: string,
  now = Date.now()
): RelativeTimeLabel | null {
  const fromMs = sessionTimestampToMs(timestamp)

  if (fromMs === null) {
    return null
  }

  const date = new Date(fromMs)
  const dateTime = date.toISOString()
  const absoluteLabel = absoluteFormatter(locale).format(date)
  const diffMs = fromMs - now

  if (Math.abs(diffMs) < JUST_NOW_MS) {
    return { label: justNow, dateTime, absoluteLabel }
  }

  const absMs = Math.abs(diffMs)
  const { unit, ms } =
    RELATIVE_UNITS.find((item) => absMs >= item.ms) ??
    RELATIVE_UNITS[RELATIVE_UNITS.length - 1]
  const value = Math.round(diffMs / ms)
  const label = relativeFormatter(locale).format(value, unit)

  return { label, dateTime, absoluteLabel }
}

export function useTickingNow(intervalMs = TICK_MS) {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, intervalMs)

    return () => {
      window.clearInterval(id)
    }
  }, [intervalMs])

  return now
}

// Lets one ticking clock at the top of a list drive many relative-time labels
// without re-rendering the rows that contain them.
const TickingNowContext = React.createContext<number | null>(null)

export const TickingNowProvider = TickingNowContext.Provider

/** The shared tick when inside a provider, otherwise the current time. */
export function useSharedNow() {
  const now = React.useContext(TickingNowContext)
  return now ?? Date.now()
}
