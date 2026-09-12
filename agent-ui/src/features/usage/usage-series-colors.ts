// Stacked model series and the model table share this palette so a row and
// its bar segment carry the same colour. Spelled out so Tailwind sees each
// theme variable referenced and emits it; a template literal would leave the
// tokens out of the generated CSS.
export const SERIES_COLORS = [
  "var(--color-usage-series-1)",
  "var(--color-usage-series-2)",
  "var(--color-usage-series-3)",
  "var(--color-usage-series-4)",
  "var(--color-usage-series-5)",
] as const

export function seriesColor(index: number) {
  return SERIES_COLORS[Math.min(index, SERIES_COLORS.length - 1)]
}
