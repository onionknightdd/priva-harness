/** Provider duration wins. Otherwise the clock is the gap from the message start to the last event. */
export function settledRunDuration(
  createdAt: string,
  atMs: number | undefined,
  reported?: number,
): number | undefined {
  if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) return reported
  const start = Date.parse(createdAt)
  if (atMs === undefined || !Number.isFinite(start) || start <= 0 || atMs <= start) return undefined
  return atMs - start
}
