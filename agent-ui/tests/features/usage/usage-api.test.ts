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
