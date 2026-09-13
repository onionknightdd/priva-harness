import assert from "node:assert/strict"
import { test } from "node:test"

import {
  browserTimeZone,
  heatmapActivities,
  matchingPreset,
  modelSeries,
  OTHER_MODELS_KEY,
  presetRange,
  usageOverviewUrl,
  usageRangeUrl,
  type UsageModel,
} from "../../../src/features/usage/usage-api.ts"

const model = (name: string, processedTokens: number): UsageModel => ({
  model: name, runs: 1, share: 0, inputTokens: processedTokens, outputTokens: 0,
  cacheReadTokens: 0, cacheWriteTokens: 0, processedTokens, costUsd: null, runsWithoutCost: 0,
})

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

test("model series buckets days into months and keeps empty months in the window", () => {
  const window = [
    { date: "2026-07-30" }, { date: "2026-07-31" }, { date: "2026-08-01" }, { date: "2026-09-01" },
  ]
  const series = modelSeries(
    window,
    [
      { date: "2026-07-30", byModel: { a: 10, b: 1 } },
      { date: "2026-07-31", byModel: { a: 5 } },
      { date: "2026-09-01", byModel: { b: 2 } },
    ],
    [model("a", 15), model("b", 3)]
  )
  assert.deepEqual(series.keys, ["a", "b"])
  assert.deepEqual(series.months, [
    { month: "2026-07-01", byModel: { a: 15, b: 1 } },
    { month: "2026-08-01", byModel: { a: 0, b: 0 } },
    { month: "2026-09-01", byModel: { a: 0, b: 2 } },
  ])
})

test("model series ranks by processed tokens and folds the tail into others", () => {
  const models = ["m1", "m2", "m3", "m4", "m5", "m6"].map((name, index) => model(name, 100 - index))
  const series = modelSeries(
    [{ date: "2026-09-01" }],
    [{ date: "2026-09-01", byModel: { m6: 1, m5: 2, m1: 50, m4: 4 } }],
    [...models].reverse()
  )
  assert.deepEqual(series.keys, ["m1", "m2", "m3", "m4", "m5", OTHER_MODELS_KEY])
  assert.deepEqual(series.months[0]?.byModel, { m1: 50, m2: 0, m3: 0, m4: 4, m5: 2, [OTHER_MODELS_KEY]: 1 })
})

test("model series has no others bucket when every model fits", () => {
  const series = modelSeries([{ date: "2026-09-01" }], [], [model("a", 1), model("b", 2)])
  assert.deepEqual(series.keys, ["b", "a"])
})

test("range presets end today and cover exactly the preset length", () => {
  assert.deepEqual(presetRange(7, "2026-09-13"), { from: "2026-09-07", to: "2026-09-13" })
  assert.deepEqual(presetRange(30, "2026-03-01"), { from: "2026-01-31", to: "2026-03-01" })
  assert.deepEqual(presetRange(365, "2026-09-13"), { from: "2025-09-14", to: "2026-09-13" })
})

test("a range matches a preset only when both ends line up", () => {
  assert.equal(matchingPreset({ from: "2026-09-07", to: "2026-09-13" }, "2026-09-13"), 7)
  assert.equal(matchingPreset({ from: "2026-09-07", to: "2026-09-12" }, "2026-09-13"), null)
  assert.equal(matchingPreset({ from: "2026-09-01", to: "2026-09-13" }, "2026-09-13"), null)
})

test("range URL carries the zone and both inclusive dates", () => {
  const url = new URL(usageRangeUrl({ timeZone: "Asia/Shanghai", from: "2026-08-01", to: "2026-09-13" }), "http://localhost")
  assert.equal(url.pathname, "/api/sandbox/usage/range")
  assert.equal(url.searchParams.get("tz"), "Asia/Shanghai")
  assert.equal(url.searchParams.get("from"), "2026-08-01")
  assert.equal(url.searchParams.get("to"), "2026-09-13")
})
