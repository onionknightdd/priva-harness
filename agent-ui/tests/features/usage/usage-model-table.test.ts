import assert from "node:assert/strict"
import { test } from "node:test"

import { modelRows, OTHER_MODELS_KEY, type UsageModel } from "../../../src/features/usage/usage-api.ts"

const model = (name: string, processedTokens: number, extra: Partial<UsageModel> = {}): UsageModel => ({
  model: name, runs: 1, share: 0, inputTokens: processedTokens, outputTokens: 0,
  cacheReadTokens: 0, cacheWriteTokens: 0, processedTokens, costUsd: 1, runsWithoutCost: 0, ...extra,
})

test("model rows rank by processed tokens and fold the tail into others with summed figures", () => {
  const rows = modelRows([
    model("m6", 6, { share: 0.06, runs: 6, costUsd: null, runsWithoutCost: 6 }),
    model("m1", 100, { share: 0.5 }),
    model("m2", 40, { share: 0.2 }),
    model("m5", 8, { share: 0.08, runs: 2, costUsd: 0.5 }),
    model("m3", 30, { share: 0.1 }),
    model("m4", 20, { share: 0.06 }),
  ])
  assert.deepEqual(rows.map((row) => row.key), ["m1", "m2", "m3", "m4", OTHER_MODELS_KEY])
  assert.deepEqual(rows[4], {
    key: OTHER_MODELS_KEY, processedTokens: 14, share: 0.14, costUsd: 0.5, runsWithoutCost: 6, runs: 8,
  })
})

test("model rows have no others row when every model fits", () => {
  assert.deepEqual(modelRows([model("a", 1), model("b", 2)]).map((row) => row.key), ["b", "a"])
})
