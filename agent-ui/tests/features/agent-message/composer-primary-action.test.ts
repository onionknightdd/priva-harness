import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { composerPrimaryAction } from "../../../src/features/agent-message/composer-primary-action.ts"

describe("composerPrimaryAction", () => {
  it("is stop while streaming with an empty draft", () => {
    assert.equal(composerPrimaryAction("", true), "stop")
    assert.equal(composerPrimaryAction("   ", true), "stop")
  })

  it("is send when the draft has content, even while streaming", () => {
    assert.equal(composerPrimaryAction("follow up", true), "send")
  })

  it("is send when nothing is streaming", () => {
    assert.equal(composerPrimaryAction("", false), "send")
    assert.equal(composerPrimaryAction("hello", false), "send")
  })
})
