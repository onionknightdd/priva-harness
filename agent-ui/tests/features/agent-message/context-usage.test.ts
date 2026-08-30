import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  contextUsagePercent,
  contextUsageSegments,
  contextUsageTone,
  emptyContextUsage,
  formatTokenCount,
} from "../../../src/features/agent-message/context-usage.ts"

describe("context usage helpers", () => {
  it("starts empty with every category unset", () => {
    const usage = emptyContextUsage()

    assert.equal(usage.used, null)
    assert.equal(usage.limit, null)
    assert.deepEqual(
      usage.categories.map((category) => category.id),
      [
        "systemPrompt",
        "toolDefinitions",
        "rules",
        "skills",
        "mcpTools",
        "subagentDefinitions",
        "conversation",
      ]
    )
    assert.ok(usage.categories.every((category) => category.tokens === null))
  })

  it("computes percent only when used and limit are known", () => {
    assert.equal(contextUsagePercent(emptyContextUsage()), null)
    assert.equal(
      contextUsagePercent({ used: 61600, limit: null, categories: [] }),
      null
    )
    assert.equal(
      contextUsagePercent({ used: 61600, limit: 256000, categories: [] }),
      24
    )
  })

  it("maps percent to ring tone", () => {
    assert.equal(contextUsageTone(null), "empty")
    assert.equal(contextUsageTone(24), "normal")
    assert.equal(contextUsageTone(70), "warn")
    assert.equal(contextUsageTone(89), "warn")
    assert.equal(contextUsageTone(90), "crit")
  })

  it("formats token counts like the Context Usage panel", () => {
    assert.equal(formatTokenCount(988), "988")
    assert.equal(formatTokenCount(9200), "9.2K")
    assert.equal(formatTokenCount(61600), "61.6K")
    assert.equal(formatTokenCount(256000), "256K")
    assert.equal(formatTokenCount(1_000_000), "1M")
  })

  it("builds bar segments from category tokens against the window", () => {
    assert.deepEqual(contextUsageSegments(emptyContextUsage()), [])
    assert.deepEqual(
      contextUsageSegments({
        used: 50,
        limit: 100,
        categories: [
          { id: "systemPrompt", tokens: 10 },
          { id: "conversation", tokens: 40 },
          { id: "rules", tokens: null },
        ],
      }),
      [
        { id: "systemPrompt", fraction: 0.1 },
        { id: "conversation", fraction: 0.4 },
      ]
    )
  })
})
