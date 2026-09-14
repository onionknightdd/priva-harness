import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { fitSessionTitle } from "../../../src/features/agent-message/fit-session-title.ts"

describe("fitSessionTitle", () => {
  it("keeps short titles and titles that exactly fill 160px intact", () => {
    const measure = (text: string) => text.length * 10
    for (const title of ["", "Session", "abcdefghijklmnop"]) {
      assert.equal(fitSessionTitle(title, 160, measure), title)
    }
  })

  it("reserves space for both ellipsis characters before fitting Chinese text", () => {
    const measure = (text: string) => Array.from(text).reduce(
      (width, character) => width + (character === "…" ? 14 : 16), 0
    )
    const result = fitSessionTitle("一二三四五六七八九十甲乙", 160, measure)
    assert.equal(result, "一二三四五六七八……")
    assert.ok(measure(result) <= 160)
    assert.ok(measure("一二三四五六七八九……") > 160)
  })

  it("uses measured widths for mixed text and fractional boundaries", () => {
    const widths: Record<string, number> = { W: 15.25, i: 3.5, 中: 14, "…": 14 }
    const measure = (text: string) => Array.from(text).reduce((width, character) => width + widths[character], 0)
    const title = "Wi中".repeat(8)
    const result = fitSessionTitle(title, 160, measure)
    assert.equal(result, "Wi中Wi中Wi中Wi中……")
    assert.ok(measure(result) <= 160)
    assert.ok(measure("Wi中Wi中Wi中Wi中W……") > 160)
  })

  it("keeps emoji sequences and combining characters whole", () => {
    for (const character of ["😀", "👨‍👩‍👧‍👦", "👍🏽", "🇨🇳", "e\u0301", "क्\u200dष"]) {
      const measure = (text: string) => text.replaceAll(character, "X").length * 10
      assert.equal(fitSessionTitle(character.repeat(20), 160, measure), character.repeat(14) + "……")
    }
  })

  it("measures the prefix together with the suffix to account for font shaping", () => {
    const measure = (text: string) => text.length * 10 + (text.endsWith("A……") ? 7 : 0)
    assert.equal(fitSessionTitle("A".repeat(20), 160, measure), "A".repeat(13) + "……")
  })

  it("never clips a character or the suffix when space is insufficient", () => {
    const measure = (text: string) => Array.from(text).reduce(
      (width, character) => width + (character === "…" ? 14 : 32), 0
    )
    assert.equal(fitSessionTitle("中", 30, measure), "……")
    assert.equal(fitSessionTitle("中", 20, measure), "")
    assert.equal(fitSessionTitle("中", 0, measure), "")
  })
})
