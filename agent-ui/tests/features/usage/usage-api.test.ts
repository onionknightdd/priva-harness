import assert from "node:assert/strict"
import { test } from "node:test"

import {
  browserTimeZone,
  heatmapActivities,
  usageOverviewUrl,
} from "../../../src/features/usage/usage-api.ts"

test("overview URL carries the IANA zone and requested day count", () => {
  const url = new URL(
    usageOverviewUrl({ timeZone: "Asia/Shanghai", days: 365 }),
    "http://localhost"
  )
  assert.equal(url.pathname, "/api/sandbox/usage/overview")
  assert.equal(url.searchParams.get("tz"), "Asia/Shanghai")
  assert.equal(url.searchParams.get("days"), "365")
})

test("browser time zone falls back to UTC only when the runtime reports none", () => {
  const zone = browserTimeZone()
  assert.equal(zone.length > 0, true)
  assert.equal(zone, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")
})

test("heatmap cells use processed tokens and keep zero days as empty cells", () => {
  const cells = heatmapActivities([
    { date: "2026-09-10", runs: 0, processedTokens: 0 },
    { date: "2026-09-11", runs: 3, processedTokens: 42_000 },
  ])
  assert.deepEqual(cells, [
    { date: "2026-09-10", value: 0 },
    { date: "2026-09-11", value: 42_000 },
  ])
})

// 2026-09-06 is a Sunday, 2026-09-07 a Monday: the week boundary must split
// them even though they are consecutive days.
const week = [
  { date: "2026-09-05", runs: 1, processedTokens: 100 },
  { date: "2026-09-06", runs: 1, processedTokens: 200 },
  { date: "2026-09-07", runs: 1, processedTokens: 1_000 },
  { date: "2026-09-08", runs: 0, processedTokens: 0 },
  { date: "2026-09-09", runs: 1, processedTokens: 5_000 },
]

test("weekly mode repeats the Monday-start week total on every day of that week", () => {
  assert.deepEqual(
    heatmapActivities(week, "weekly").map((cell) => cell.value),
    [300, 300, 6_000, 6_000, 6_000]
  )
})

test("cumulative mode carries a running total across the window", () => {
  assert.deepEqual(
    heatmapActivities(week, "cumulative").map((cell) => cell.value),
    [100, 300, 1_300, 1_300, 6_300]
  )
})
